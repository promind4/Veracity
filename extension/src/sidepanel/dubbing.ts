import { geminiKeys } from '../../../core/gemini';
import { type DubCue, type DubGroup, planDubGroups } from '../../../core/dub';
import { assignVoices, type Speaker } from '../../../core/speakers';
import { GEMINI_TTS_MODELS, geminiSpeak } from '../../../core/tts-gemini';
import { type Config, UserError } from '../../../core/types';
import { piperVoiceFor, type TtsEngine } from '../../../core/voices';
import { dubPlayer } from '../shared/dubPlayer';
import { PiperClient } from '../shared/tts/piper';

export interface DubView {
  text: string;
  error: boolean;
}

type Synth = (text: string, voice: string) => Promise<{ wav: Uint8Array<ArrayBuffer>; durationS: number }>;

interface Session {
  tabId: number;
  videoId: string;
  engine: TtsEngine;
  voice: string;
  lang: string;
  groups: DubGroup[];
  cues: DubCue[];
  config: Config;
  /** Voix de chaque intervenant (vide : une seule voix pour toute la vidéo). */
  voices: Record<string, string>;
  speakers?: Speaker[];
  label: string;
  text: string;
  error: boolean;
  busy: boolean;
  stopped: boolean;
  timer?: ReturnType<typeof setInterval>;
}

// Avance de génération sur la lecture : Gemini est lent par requête mais regroupe les phrases.
const LOOKAHEAD_S: Record<TtsEngine, number> = { gemini: 120, piper: 45, browser: 0 };
// Gemini : phrases regroupées (≈20 s) pour économiser le quota ; Piper : phrase par phrase.
const GROUP_S: Record<TtsEngine, number> = { gemini: 20, piper: 0, browser: 0 };

/** « fr_FR-tom-medium » → « tom » ; les voix Gemini restent telles quelles. */
const shortVoice = (voice: string) => voice.match(/^[a-z]{2}_[A-Z]{2}-([^-]+)/)?.[1] ?? voice;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Pilote le doublage : génère l'audio en avance sur la lecture et l'envoie au lecteur de la page. */
export class DubController {
  private sessions = new Map<string, Session>();
  private piper = new PiperClient();
  private cache = new Map<string, { b64: string; dur: number }>();

  constructor(
    private onChange: (videoId: string) => void,
    private notify: (message: string) => void,
  ) {}

  isOn(videoId: string): boolean {
    return this.sessions.has(videoId);
  }

  view(videoId: string): DubView | null {
    const s = this.sessions.get(videoId);
    return s ? { text: s.text, error: s.error } : null;
  }

  /** `speakers` (facultatif) : une voix par intervenant, les sous-titres portant leur intervenant. */
  async start(tabId: number, videoId: string, cues: DubCue[], config: Config, speakers?: Speaker[]): Promise<void> {
    await this.stop(videoId);
    for (const key of this.cache.keys()) if (!key.startsWith(`${videoId}|`)) this.cache.delete(key);
    const engine = config.ttsEngine ?? 'gemini';
    const lang = config.targetLang ?? 'fr';
    if (engine === 'gemini' && !config.geminiKey) throw new UserError('config', 'Ajoute une clé Gemini dans les options, ou choisis Piper comme moteur de doublage.');
    const voice = engine === 'gemini' ? (config.geminiVoice ?? 'Kore') : engine === 'piper' ? piperVoiceFor(lang, config.piperVoice) : (config.browserVoice ?? '');
    if (engine === 'piper' && !voice) throw new UserError('config', `Aucune voix Piper pour la langue « ${lang} ».`);
    const groups = planDubGroups(cues, GROUP_S[engine]);
    const ready = await dubPlayer(tabId, {
      kind: 'init',
      videoId,
      groups,
      mode: engine === 'browser' ? 'speech' : 'audio',
      duck: config.duckVolume ?? 0.2,
      voiceName: engine === 'browser' ? voice : undefined,
      lang,
      waitForAudio: config.dubWait !== false,
    });
    if (!ready) throw new Error('Lecteur YouTube introuvable dans l’onglet.');
    const voices = speakers && speakers.length > 1 ? assignVoices(speakers, engine, lang, voice) : {};
    const engineName = engine === 'gemini' ? 'Gemini' : engine === 'piper' ? 'Piper' : 'Navigateur';
    const label = Object.keys(voices).length
      ? `${engineName} · ${speakers!.map((sp) => `${sp.label || sp.id} → ${shortVoice(voices[sp.id])}`).join(', ')}`
      : `${engineName}${voice ? ` · ${shortVoice(voice)}` : ''}`;
    const session: Session = {
      tabId,
      videoId,
      engine,
      voice: voice ?? '',
      lang,
      groups,
      cues,
      config,
      voices,
      speakers,
      label,
      text: label,
      error: false,
      busy: false,
      stopped: false,
    };
    this.sessions.set(videoId, session);
    this.onChange(videoId);
    if (engine === 'browser') return;
    session.timer = setInterval(() => void this.pump(session), 1000);
    void this.pump(session);
  }

  async stop(videoId: string): Promise<void> {
    const s = this.sessions.get(videoId);
    if (!s) return;
    s.stopped = true;
    clearInterval(s.timer);
    this.sessions.delete(videoId);
    await dubPlayer(s.tabId, { kind: 'stop' }).catch(() => null);
    this.onChange(videoId);
  }

  private synth(s: Session): Synth {
    if (s.engine === 'gemini') {
      // Un seul modèle pour toute la vidéo : changer de modèle en cours de route change le timbre de la voix.
      const model = s.config.geminiTtsModel ?? GEMINI_TTS_MODELS[0];
      return (text, voice) => geminiSpeak(text, { key: geminiKeys(s.config), voice, lang: s.lang, models: [model], attempts: 4 });
    }
    return (text, voice) =>
      this.piper.speak(text, voice, (loaded, total) => {
        s.text = `${s.label} · téléchargement de la voix ${Math.round((100 * loaded) / (total || 1))} %`;
        this.onChange(s.videoId);
      });
  }

  /** Génère le prochain passage manquant dans la fenêtre d'avance (un à la fois). */
  private async pump(s: Session): Promise<void> {
    if (s.busy || s.stopped) return;
    s.busy = true;
    try {
      const status = await dubPlayer(s.tabId, { kind: 'status' });
      if (!status?.active) {
        // L'utilisateur a changé de vidéo ou rechargé la page.
        await this.stop(s.videoId);
        return;
      }
      const have = new Set(status.have);
      const waiting = status.waitingFor !== null ? ' · vidéo en pause le temps de préparer la voix' : '';
      s.text = `${s.label} · ${have.size}/${s.groups.length} passages prêts${status.missed ? ` · ${status.missed} sauté(s)` : ''}${waiting}`;
      // Pendant une publicité, le temps de la vidéo n'a pas de sens : on attend.
      if (status.ad) return;
      const next =
        status.waitingFor ?? s.groups.findIndex((g, i) => !have.has(i) && g.start >= status.time - 0.5 && g.start <= status.time + LOOKAHEAD_S[s.engine]);
      if (next === -1) return;
      const group = s.groups[next];
      const voice = (group.speaker && s.voices[group.speaker]) || s.voice;
      const key = `${s.videoId}|${s.engine}|${voice}|${s.lang}|${s.groups.length}|${next}`;
      let clip = this.cache.get(key);
      if (!clip) {
        // « >> » (changement d'intervenant dans les sous-titres) ne doit pas être lu.
        const out = await this.synth(s)(group.text.replace(/>>\s*/g, ''), voice);
        clip = { b64: bytesToBase64(out.wav), dur: out.durationS };
        this.cache.set(key, clip);
      }
      if (!s.stopped) await dubPlayer(s.tabId, { kind: 'add', index: next, wavBase64: clip.b64, durationS: clip.dur });
    } catch (e) {
      if (e instanceof UserError && e.code === 'quota' && s.engine === 'gemini') {
        this.notify('Quota Gemini atteint : le doublage continue avec Piper.');
        s.busy = false;
        await this.start(s.tabId, s.videoId, s.cues, { ...s.config, ttsEngine: 'piper' }, s.speakers);
        return;
      }
      clearInterval(s.timer);
      s.error = true;
      s.text = `${s.label} · erreur : ${(e as Error).message}`;
    } finally {
      s.busy = false;
      this.onChange(s.videoId);
    }
  }
}
