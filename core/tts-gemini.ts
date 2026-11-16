import { TARGET_LANGUAGES } from './translate';
import { type FetchFn, UserError } from './types';

// Ordre établi à l'écoute (2026-10-12) : 2.5 parle au rythme le plus proche de l'original,
// les 3.8 sont plus lents (15 à 17 s contre 12 s pour le même passage).
export const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
export const GEMINI_VOICES = ['Kore', 'Charon', 'Puck', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Zephyr'];

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export function pcmToWav(pcm: Uint8Array, rate: number, channels = 1): Uint8Array<ArrayBuffer> {
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

export function wavDuration(wav: Uint8Array): number {
  const byteRate = new DataView(wav.buffer, wav.byteOffset).getUint32(28, true);
  return byteRate ? (wav.length - 44) / byteRate : 0;
}

function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface GeminiSpeakOptions {
  /** Une clé, ou plusieurs : la suivante prend le relais quand le quota de la précédente est atteint (même modèle, donc même voix). */
  key: string | string[];
  voice: string;
  lang: string;
  models?: string[];
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  /** Essais par modèle (défaut 2) : 503 → attente croissante de 3 s, 6 s… ; 429 → 10 s. */
  attempts?: number;
}

/**
 * Synthèse vocale Gemini → WAV. Chaque modèle a son propre quota : un 429 fait passer au
 * modèle suivant, et seule l'épuisement de tous les modèles est signalé comme quota.
 * Pour un doublage, passer UN seul modèle : changer de modèle en cours de vidéo change le timbre.
 */
export async function geminiSpeak(text: string, opts: GeminiSpeakOptions): Promise<{ wav: Uint8Array<ArrayBuffer>; durationS: number; model: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const language = TARGET_LANGUAGES[opts.lang] ?? opts.lang;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Lis ce texte en ${language}, d'une voix naturelle et à un rythme soutenu, sans rien ajouter : ${text}` }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } } } },
  });
  const errors: string[] = [];
  let quotaOnly = true;
  const keys = ([] as string[]).concat(opts.key);
  for (const model of opts.models ?? GEMINI_TTS_MODELS) {
    for (const [keyIndex, key] of keys.entries()) {
      const lastKey = keyIndex === keys.length - 1;
      const label = keys.length > 1 ? `${model} (clé ${keyIndex + 1})` : model;
      const attempts = opts.attempts ?? 2;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const res = await fetchFn(`${ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'X-goog-api-key': key, 'Content-Type': 'application/json' },
          body,
        });
        if (res.status === 429 || res.status === 503) {
          errors.push(`${label}: ${res.status === 429 ? 'quota' : 'saturé'}`);
          if (res.status === 503) quotaOnly = false;
          // Quota atteint et une autre clé disponible : on bascule tout de suite, sans attendre.
          if (res.status === 429 && !lastKey) break;
          if (attempt < attempts - 1) {
            await sleep(res.status === 429 ? 10_000 : 3000 * (attempt + 1));
            continue;
          }
          break;
        }
        quotaOnly = false;
        if (res.status === 400 && /api key/i.test(await res.clone().text())) {
          if (lastKey) throw new UserError('config', 'Clé Gemini refusée : vérifie-la dans les options.');
          errors.push(`${label}: clé refusée`);
          break;
        }
        if (!res.ok) {
          errors.push(`${label}: HTTP ${res.status}`);
          break;
        }
        const payload = await res.json();
        const audio = (payload.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData as
          | { mimeType: string; data: string }
          | undefined;
        if (!audio) {
          errors.push(`${label}: pas d'audio`);
          break;
        }
        const bytes = base64ToBytes(audio.data);
        const isWav = String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
        const wav = isWav ? bytes : pcmToWav(bytes, Number(audio.mimeType.match(/rate=(\d+)/)?.[1] ?? 24000));
        return { wav, durationS: wavDuration(wav), model };
      }
    }
  }
  if (quotaOnly) throw new UserError('quota', 'Quota gratuit de synthèse vocale Gemini atteint pour aujourd’hui.');
  throw new UserError('llm', `Synthèse vocale Gemini impossible : ${errors.join(' | ')}`);
}
