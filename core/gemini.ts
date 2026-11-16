import { type FetchFn, UserError } from './types';

// Ordre établi par des essais réels (2026-10-12) : lite-latest est rapide et disponible ;
// les autres servent de secours quand Google renvoie 503 (saturation fréquente).
export const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-flash-latest'];

/**
 * Modèles pour l'analyse, la discussion et le lexique : comparatif du 2026-10-13 sur 5 vidéos de référence.
 * gemini-3-flash-preview classe correctement les 5 vidéos (science 99 %, Terre plate 21 %, formation « devenir riche » 38 %) en 20 à 60 s ;
 * flash-lite renvoie souvent un JSON inexploitable ; flash-latest est lent (jusqu'à 137 s) et souvent saturé.
 */
export const GEMINI_ANALYSIS_MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest'];

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiPart = { text: string } | { fileData: { fileUri: string }; videoMetadata?: { fps: number } };

export interface GeminiOptions {
  /** Une clé, ou plusieurs : la suivante prend le relais quand le quota de la précédente est épuisé. */
  key: string | string[];
  models?: string[];
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  generationConfig?: Record<string, unknown>;
  /** Essais par modèle en cas de saturation (503/429), avec une attente croissante (défaut : 2). */
  attempts?: number;
  /** Message affiché si Gemini refuse la requête (400 hors clé invalide). */
  badRequestMessage?: string;
  /** Préfixe du message d'échec global. */
  failurePrefix?: string;
}

/** Modèles dont le quota du jour est épuisé, jusqu'à l'heure donnée par Google : inutile de les réessayer (le quota gratuit est de 20 requêtes par jour et par modèle). */
const exhausted = new Map<string, number>();
export const resetQuotaMemory = () => exhausted.clear();

/** Clés Gemini de la configuration, dans l'ordre d'essai (la clé de secours n'est utilisée que quand la principale est épuisée). */
export const geminiKeys = (c: { geminiKey?: string; geminiKey2?: string }): string[] => [c.geminiKey, c.geminiKey2].filter((k): k is string => Boolean(k));

/** « Please retry in 10h5m48.9s » → millisecondes ; null si le message n'en donne pas. */
export function parseRetryDelay(message: string): number | null {
  const m = message.match(/retry in ((?:\d+(?:\.\d+)?[hms])+)/i);
  if (!m) return null;
  let ms = 0;
  for (const [, n, unit] of m[1].matchAll(/(\d+(?:\.\d+)?)([hms])/g)) ms += Number(n) * { h: 3_600_000, m: 60_000, s: 1000 }[unit as 'h' | 'm' | 's'];
  return ms;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Appelle generateContent sur chaque modèle : un nouvel essai après 503/429, modèle suivant
 * après 403/404 ou une réponse refusée par `accept`.
 */
export async function geminiGenerate(
  parts: GeminiPart[],
  opts: GeminiOptions,
  accept: (text: string) => boolean = (text) => text.trim().length > 0,
): Promise<{ text: string; model: string }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const keys = ([] as string[]).concat(opts.key);
  const refused = new Set<string>();
  const body = JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, maxOutputTokens: 65536, ...opts.generationConfig } });
  const errors: string[] = [];
  for (const model of opts.models ?? GEMINI_MODELS) {
    // Chaque clé a son propre quota par modèle : quand l'une est épuisée, on passe à la suivante avant de changer de modèle.
    for (const [keyIndex, key] of keys.entries()) {
      const label = keys.length > 1 ? `${model} (clé ${keyIndex + 1})` : model;
      const slot = `${model}|${key.slice(-8)}`;
      if (refused.has(key)) continue;
      if ((exhausted.get(slot) ?? 0) > Date.now()) {
        errors.push(`${label}: quota du jour épuisé`);
        continue;
      }
      const attempts = opts.attempts ?? 2;
      for (let attempt = 0; attempt < attempts; attempt++) {
        let res: Response;
        try {
          res = await fetchFn(`${ENDPOINT}/${model}:generateContent`, {
            method: 'POST',
            headers: { 'X-goog-api-key': key, 'Content-Type': 'application/json' },
            body,
          });
        } catch (e) {
          errors.push(`${label}: réseau (${(e as Error).message})`);
          break;
        }
        if (res.status === 429) {
          const retryMs = parseRetryDelay(await res.text());
          if (retryMs === null || retryMs >= 120_000) {
            // Quota du jour épuisé (ou délai long) : on passe à la clé ou au modèle suivant et on s'en souvient.
            exhausted.set(slot, Date.now() + (retryMs ?? 3 * 3_600_000));
            errors.push(`${label}: quota du jour épuisé`);
            break;
          }
          errors.push(`${label}: saturé (429)`);
          if (attempt < attempts - 1) {
            await sleep(Math.max(5000 * (attempt + 1), retryMs));
            continue;
          }
          break;
        }
        if (res.status === 503) {
          errors.push(`${label}: saturé (503)`);
          if (attempt < attempts - 1) {
            await sleep(5000 * (attempt + 1));
            continue;
          }
          break;
        }
        if (res.status === 400) {
          if (/api key/i.test(await res.text())) {
            refused.add(key);
            if (refused.size >= keys.length) throw new UserError('config', 'Clé Gemini refusée : vérifie-la dans les options.');
            errors.push(`${label}: clé refusée`);
            break;
          }
          throw new UserError('unavailable', opts.badRequestMessage ?? 'Requête refusée par Gemini.');
        }
        if (!res.ok) {
          errors.push(`${label}: HTTP ${res.status}`);
          break;
        }
        const payload = await res.json();
        const text: string = (payload.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
        if (accept(text)) return { text, model };
        errors.push(`${label}: réponse inexploitable`);
        break;
      }
    }
  }
  throw new UserError('llm', `${opts.failurePrefix ?? 'Gemini indisponible'} : ${errors.join(' | ')}`);
}
