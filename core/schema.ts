import { z } from 'zod';

/** « Plutôt vrai » → « plutot_vrai » : rend les sorties du LLM comparables aux enums. */
export function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function enumOf<T extends readonly [string, ...string[]]>(values: T, fallback?: T[number]) {
  return z.preprocess((v) => {
    const token = normalizeToken(v);
    if (fallback !== undefined && !(values as readonly string[]).includes(token)) return fallback;
    return token;
  }, z.enum(values as unknown as [T[number], ...T[number][]]));
}

export function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const s = String(value ?? '')
    .trim()
    .replace(/^\[|\]$/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(':').map(Number);
  if (parts.length >= 2 && parts.every(Number.isFinite)) return parts.reduce((acc, p) => acc * 60 + p, 0);
  return 0;
}

export const Timestamp = z.preprocess(parseTimestamp, z.number());

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Aucun objet JSON dans la réponse');
  return JSON.parse(body.slice(start, end + 1));
}
