import type { Cue } from './cues';
import { geminiGenerate } from './gemini';
import type { FetchFn } from './types';
import type { TtsEngine } from './voices';
import { formatTime } from './youtube';

export type Gender = 'homme' | 'femme' | 'inconnu';

export interface Speaker {
  id: string;
  gender: Gender;
  label: string;
}

export interface SpeakerMap {
  speakers: Speaker[];
  /** Intervenant de chaque sous-titre (même ordre que les sous-titres envoyés). */
  byCue: string[];
}

const normalizeGender = (raw: string): Gender => (/f[eé]m/i.test(raw) ? 'femme' : /hom|masc/i.test(raw) ? 'homme' : 'inconnu');

/** Lit « S1 | homme | rôle » puis « [n] S1 » ; un sous-titre sans attribution reprend l'intervenant précédent. */
export function parseSpeakers(text: string, cueCount: number): SpeakerMap {
  const speakers: Speaker[] = [];
  const assigned = new Map<number, string>();
  for (const line of text.split('\n')) {
    const described = line.match(/^\s*(S\d+)\s*\|\s*([^|]*?)\s*\|\s*(.*)$/);
    if (described) {
      if (!speakers.some((s) => s.id === described[1])) speakers.push({ id: described[1], gender: normalizeGender(described[2]), label: described[3].trim() });
      continue;
    }
    const attribution = line.match(/^\s*\[(\d+)\]\s*(S\d+)/);
    if (attribution) assigned.set(Number(attribution[1]), attribution[2]);
  }
  for (const id of assigned.values()) {
    if (!speakers.some((s) => s.id === id)) speakers.push({ id, gender: 'inconnu', label: '' });
  }
  if (!speakers.length) speakers.push({ id: 'S1', gender: 'inconnu', label: '' });
  const byCue: string[] = [];
  for (let n = 1; n <= cueCount; n++) byCue.push(assigned.get(n) ?? byCue[n - 2] ?? speakers[0].id);
  return { speakers, byCue };
}

export function buildSpeakerPrompt(cues: Cue[]): string {
  return `Identifie qui parle dans cette vidéo, en t'appuyant sur les voix et sur les mots prononcés.
Voici ses sous-titres numérotés (horodatage de début entre parenthèses) :
${cues.map((c, i) => `[${i + 1}] (${formatTime(c.start)}) ${c.text}`).join('\n')}

Réponds exactement dans ce format, sans aucun autre texte :
INTERVENANTS
S1 | homme ou femme | nom ou rôle si on le connaît, sinon vide
(une ligne par personne qui parle ; S1 est la première à parler ; un narrateur ou une voix off compte comme un intervenant)
ATTRIBUTION
[1] S1
[2] S2
(une ligne pour CHAQUE numéro de sous-titre)`;
}

/** Une requête Gemini par vidéo (gratuite) : Gemini écoute la vidéo et attribue chaque sous-titre. */
export async function detectSpeakers(
  videoId: string,
  cues: Cue[],
  opts: { key: string | string[]; fetchFn?: FetchFn; sleep?: (ms: number) => Promise<void> },
): Promise<SpeakerMap & { model: string }> {
  const { text, model } = await geminiGenerate(
    [
      { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` }, videoMetadata: { fps: 0.1 } },
      { text: buildSpeakerPrompt(cues) },
    ],
    {
      ...opts,
      generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' },
      badRequestMessage: 'Gemini ne peut pas lire cette vidéo (privée, non répertoriée ou trop longue).',
      failurePrefix: 'Identification des intervenants impossible',
    },
    (t) => /\[\d+\]\s*S\d+/.test(t),
  );
  return { ...parseSpeakers(text, cues.length), model };
}

// Voix par genre ; la première de chaque liste est utilisée en premier.
const GEMINI_POOLS: Record<'homme' | 'femme', string[]> = {
  homme: ['Charon', 'Puck', 'Orus', 'Fenrir'],
  femme: ['Kore', 'Aoede', 'Leda', 'Zephyr'],
};
const PIPER_POOLS: Record<string, Record<'homme' | 'femme', string[]>> = {
  fr: { homme: ['fr_FR-tom-medium', 'fr_FR-gilles-low'], femme: ['fr_FR-siwis-medium', 'fr_FR-upmc-medium'] },
  en: { homme: ['en_GB-alan-medium'], femme: ['en_US-lessac-medium'] },
  es: { homme: ['es_ES-davefx-medium', 'es_MX-claude-high'], femme: ['es_ES-davefx-medium'] },
};

/**
 * Voix de chaque intervenant : la voix choisie dans les options sert au premier intervenant de
 * son genre, puis on prend des voix différentes (en recommençant la liste s'il en manque).
 * Le navigateur garde une seule voix (on ne connaît pas le genre de ses voix).
 */
export function assignVoices(speakers: Speaker[], engine: TtsEngine, lang: string, preferred: string | undefined): Record<string, string> {
  if (engine === 'browser') return {};
  const base = engine === 'gemini' ? GEMINI_POOLS : PIPER_POOLS[lang];
  if (!base) return {};
  const pools: Record<Gender, string[]> = {
    homme: [...base.homme],
    femme: [...base.femme],
    inconnu: base.homme.flatMap((v, i) => [v, base.femme[i]]).filter(Boolean) as string[],
  };
  for (const pool of Object.values(pools)) {
    const at = preferred ? pool.indexOf(preferred) : -1;
    if (at > 0) pool.unshift(...pool.splice(at, 1));
  }
  const used: Record<Gender, number> = { homme: 0, femme: 0, inconnu: 0 };
  const voices: Record<string, string> = {};
  for (const s of speakers) {
    const pool = pools[s.gender];
    voices[s.id] = pool[used[s.gender]++ % pool.length];
  }
  return voices;
}
