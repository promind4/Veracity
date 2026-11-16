import type { DubGroup } from '../../../core/dub';

export type DubCommand =
  | {
      kind: 'init';
      videoId: string;
      groups: DubGroup[];
      mode: 'audio' | 'speech';
      duck: number;
      voiceName?: string;
      lang: string;
      /** Met la vidéo en pause tant que l'audio du passage suivant n'est pas prêt. */
      waitForAudio: boolean;
    }
  | { kind: 'add'; index: number; wavBase64: string; durationS: number }
  | { kind: 'status' }
  | { kind: 'stop' };

export interface DubStatus {
  active: boolean;
  time: number;
  /** Passages dont l'audio est déjà dans la page. */
  have: number[];
  /** Passages sautés faute d'audio prêt à temps (uniquement sans attente). */
  missed: number;
  /** Une publicité YouTube est en cours : le temps de la vidéo n'est pas celui du contenu. */
  ad: boolean;
  /** La vidéo est en pause en attendant ce passage. */
  waitingFor: number | null;
}

/**
 * Code exécuté DANS la page YouTube (autonome : aucune référence extérieure, car sérialisé par
 * chrome.scripting). Joue chaque passage quand la vidéo atteint son début, accéléré si besoin pour
 * tenir dans sa fenêtre, baisse le volume d'origine, suit pause/lecture/saut, se tait pendant les
 * publicités, attend l'audio manquant et s'arrête si l'utilisateur change de vidéo.
 */
export function dubPlayerScript(cmd: DubCommand): DubStatus | null {
  type Clip = { url: string; dur: number };
  type State = {
    videoId: string;
    groups: DubGroup[];
    mode: 'audio' | 'speech';
    lang: string;
    voiceName?: string;
    waitForAudio: boolean;
    clips: Map<number, Clip>;
    audio: HTMLAudioElement | null;
    lastIndex: number;
    lastTime: number;
    missed: number;
    inAd: boolean;
    waitingFor: number | null;
    badge: HTMLElement;
    savedVolume: number;
    timer: number;
    stop: () => void;
  };
  const w = window as unknown as { __veracityDub?: State };
  const video = document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  const player = document.querySelector<HTMLElement>('#movie_player') ?? video?.parentElement ?? null;
  // Les publicités passent dans le même élément <video> : leur temps (0:00, 0:19…) n'est pas celui de la vidéo.
  const adShowing = () => Boolean(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'));
  const status = (s: State | undefined): DubStatus => ({
    active: Boolean(s),
    time: video?.currentTime ?? 0,
    have: s ? [...s.clips.keys()] : [],
    missed: s?.missed ?? 0,
    ad: adShowing(),
    waitingFor: s?.waitingFor ?? null,
  });

  if (cmd.kind === 'status') return status(w.__veracityDub);
  if (cmd.kind === 'stop') {
    w.__veracityDub?.stop();
    return status(undefined);
  }
  if (cmd.kind === 'add') {
    const s = w.__veracityDub;
    if (!s) return null;
    const bytes = Uint8Array.from(atob(cmd.wavBase64), (c) => c.charCodeAt(0));
    s.clips.set(cmd.index, { url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), dur: cmd.durationS });
    if (s.waitingFor === cmd.index && video) {
      s.waitingFor = null;
      s.badge.style.display = 'none';
      void video.play();
    }
    return status(s);
  }

  // init
  w.__veracityDub?.stop();
  if (!video || !player) return null;
  const badge = document.createElement('div');
  badge.textContent = '⏳ Doublage en préparation…';
  Object.assign(badge.style, {
    position: 'absolute',
    top: '12px',
    left: '12px',
    padding: '4px 10px',
    borderRadius: '6px',
    background: 'rgba(8, 8, 8, 0.8)',
    color: '#fff',
    font: '500 14px Roboto, Arial, sans-serif',
    zIndex: '61',
    pointerEvents: 'none',
    display: 'none',
  });
  player.appendChild(badge);
  const s: State = {
    videoId: cmd.videoId,
    groups: cmd.groups,
    mode: cmd.mode,
    lang: cmd.lang,
    voiceName: cmd.voiceName,
    waitForAudio: cmd.waitForAudio,
    clips: new Map(),
    audio: null,
    lastIndex: -1,
    lastTime: video.currentTime,
    missed: 0,
    inAd: false,
    waitingFor: null,
    badge,
    savedVolume: video.volume,
    timer: 0,
    stop: () => {},
  };
  const indexAt = (t: number) => {
    let lo = 0;
    let hi = s.groups.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s.groups[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };
  const silence = () => {
    s.audio?.pause();
    s.audio = null;
    if (s.mode === 'speech') speechSynthesis.cancel();
  };
  const resync = (t: number) => {
    silence();
    s.lastIndex = indexAt(t);
    s.lastTime = t;
  };
  const rateFor = (spokenS: number, windowS: number) => Math.min(1.6, Math.max(1, spokenS / Math.max(0.5, windowS - 0.15))) * video.playbackRate;
  const play = (i: number) => {
    silence();
    const g = s.groups[i];
    if (s.mode === 'speech') {
      const u = new SpeechSynthesisUtterance(g.text);
      u.lang = s.lang;
      const voice = speechSynthesis.getVoices().find((v) => v.name === s.voiceName);
      if (voice) u.voice = voice;
      // Environ 15 caractères par seconde à vitesse normale.
      u.rate = Math.min(1.8, rateFor(g.text.length / 15, g.window));
      speechSynthesis.speak(u);
      return;
    }
    const clip = s.clips.get(i);
    if (!clip) {
      s.missed++;
      return;
    }
    const audio = new Audio(clip.url);
    audio.playbackRate = rateFor(clip.dur, g.window);
    audio.preservesPitch = true;
    void audio.play();
    s.audio = audio;
  };
  // Le doublage remplace la voix d'origine : on baisse la vidéo pendant toute la session.
  video.volume = s.savedVolume * cmd.duck;
  s.timer = window.setInterval(() => {
    if (!location.href.includes(s.videoId)) return s.stop();
    if (adShowing()) {
      if (!s.inAd) silence();
      s.inAd = true;
      return;
    }
    const t = video.currentTime;
    if (s.inAd) {
      // Fin de publicité : on se recale sur la position réelle, sans rejouer le passage en cours.
      s.inAd = false;
      resync(t);
      return;
    }
    // Saut dans la vidéo : on coupe et on reprend au passage suivant (pas au milieu d'un passage).
    if (Math.abs(t - s.lastTime) > 1.5) resync(t);
    s.lastTime = t;
    if (video.paused) {
      s.audio?.pause();
      if (s.mode === 'speech' && speechSynthesis.speaking) speechSynthesis.pause();
      return;
    }
    if (s.waitingFor !== null) {
      // L'utilisateur a relancé la lecture lui-même : on n'attend plus.
      s.waitingFor = null;
      badge.style.display = 'none';
    }
    if (s.audio?.paused && !s.audio.ended) void s.audio.play();
    if (s.mode === 'speech' && speechSynthesis.paused) speechSynthesis.resume();
    const next = s.lastIndex + 1;
    if (s.mode === 'audio' && s.waitForAudio && next < s.groups.length && !s.clips.has(next)) {
      const until = s.groups[next].start - t;
      if (until <= 0.3 && until > -1) {
        video.pause();
        s.waitingFor = next;
        badge.style.display = 'block';
        return;
      }
    }
    const i = indexAt(t);
    if (i > s.lastIndex && t - s.groups[i].start < 1) {
      s.lastIndex = i;
      play(i);
    }
  }, 100);
  s.stop = () => {
    window.clearInterval(s.timer);
    silence();
    badge.remove();
    video.volume = s.savedVolume;
    for (const clip of s.clips.values()) URL.revokeObjectURL(clip.url);
    w.__veracityDub = undefined;
  };
  w.__veracityDub = s;
  return status(s);
}

export async function dubPlayer(tabId: number, command: DubCommand): Promise<DubStatus | null> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, args: [command], func: dubPlayerScript });
  return (injection?.result as DubStatus | null | undefined) ?? null;
}
