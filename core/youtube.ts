import { type FetchFn, type Segment, UserError, type VideoInput } from './types';

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
// Le client web exige un jeton anti-robot pour les sous-titres ; le client Android, non.
const ANDROID_CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38' };

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

const baseLang = (code: string) => code.toLowerCase().split('-')[0];

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // pas une URL
  }
  return null;
}

/** La piste auto-générée (asr) révèle la langue parlée ; on lui préfère une piste manuelle de même langue. */
export function chooseTrack(tracks: CaptionTrack[], preferred: string[] = ['fr', 'en']): CaptionTrack | undefined {
  const asr = tracks.find((t) => t.kind === 'asr');
  if (asr) return tracks.find((t) => t.kind !== 'asr' && baseLang(t.languageCode) === baseLang(asr.languageCode)) ?? asr;
  for (const p of preferred) {
    const t = tracks.find((track) => baseLang(track.languageCode) === p);
    if (t) return t;
  }
  return tracks[0];
}

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

export function parseJson3(json: Json3): Segment[] {
  const out: Segment[] = [];
  for (const e of json.events ?? []) {
    if (!e.segs) continue;
    const text = e.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (text) out.push({ start: Math.round((e.tStartMs ?? 0) / 100) / 10, text });
  }
  return out;
}

export function formatTime(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = Math.floor(totalS % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + `:${String(s).padStart(2, '0')}`;
}

export function groupSegments(segments: Segment[], blockS = 20): Segment[] {
  const blocks: Segment[] = [];
  for (const seg of segments) {
    const last = blocks.at(-1);
    if (last && seg.start - last.start < blockS) last.text += ' ' + seg.text;
    else blocks.push({ ...seg });
  }
  return blocks;
}

/** Regroupe les segments en blocs horodatés pour économiser des tokens. */
export function formatTranscript(segments: Segment[], maxChars = 400_000, blockS = 20): { text: string; truncated: boolean } {
  const text = groupSegments(segments, blockS)
    .map((b) => `[${formatTime(b.start)}] ${b.text}`)
    .join('\n');
  const truncated = text.length > maxChars;
  return { text: truncated ? text.slice(0, maxChars) : text, truncated };
}

/** Transcription de secours quand la vidéo n'a pas de sous-titres exploitables. */
export type TranscriptFallback = (video: { videoId: string; durationS: number }) => Promise<{ language: string; segments: Segment[] }>;

const NO_CAPTIONS_HINT = 'Ajoute une clé Gemini (gratuite) dans les options pour activer la transcription audio.';

async function captionSegments(track: CaptionTrack | undefined, fetchFn: FetchFn): Promise<Segment[]> {
  if (!track) return [];
  const res = await fetchFn(track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3');
  const body = res.ok ? await res.text() : '';
  return body ? parseJson3(JSON.parse(body)) : [];
}

export async function fetchVideo(videoId: string, fetchFn: FetchFn = fetch, hl = 'fr', fallback?: TranscriptFallback): Promise<VideoInput> {
  const res = await fetchFn(PLAYER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl } }, videoId }),
  });
  const blocked = new UserError('unavailable', 'YouTube bloque temporairement les requêtes (protection anti-robot). Réessaie dans quelques minutes.');
  if (res.status === 429) throw blocked;
  if (!res.ok) throw new UserError('unavailable', `YouTube a répondu ${res.status}.`);
  let player;
  try {
    player = JSON.parse(await res.text());
  } catch {
    throw blocked;
  }
  const status = player.playabilityStatus?.status;
  if (status && status !== 'OK') {
    throw new UserError('unavailable', `Vidéo indisponible : ${player.playabilityStatus?.reason ?? status}.`);
  }
  const d = player.videoDetails ?? {};
  const base = {
    videoId,
    title: d.title ?? '',
    author: d.author ?? '',
    channelId: typeof d.channelId === 'string' ? d.channelId : undefined,
    description: d.shortDescription ?? '',
    durationS: Number(d.lengthSeconds ?? 0),
    ...(typeof player.microformat?.playerMicroformatRenderer?.publishDate === 'string'
      ? { publishedAt: player.microformat.playerMicroformatRenderer.publishDate as string }
      : {}),
  };

  const tracks: CaptionTrack[] = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = chooseTrack(tracks);
  const segments = await captionSegments(track, fetchFn);
  if (track && segments.length) return { ...base, language: baseLang(track.languageCode), segments, transcriptSource: 'captions' };

  if (!fallback) {
    const reason = track ? 'Les sous-titres de cette vidéo sont vides ou inaccessibles.' : "Cette vidéo n'a pas de sous-titres.";
    throw new UserError('no_captions', `${reason} ${NO_CAPTIONS_HINT}`);
  }
  const transcribed = await fallback({ videoId, durationS: base.durationS });
  return { ...base, language: transcribed.language, segments: transcribed.segments, transcriptSource: 'gemini' };
}
