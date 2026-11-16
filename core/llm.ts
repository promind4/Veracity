import type { z } from 'zod';
import { extractJson } from './schema';
import { type FetchFn, UserError } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  key: string;
  models: string[];
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Attempt = { ok: true; res: Response } | { ok: false; retryable: boolean; error: string };

/** Envoie une requête ; lève une UserError pour les cas sans repli possible (clé, quota). */
async function post(opts: LlmOptions, model: string, messages: ChatMessage[], stream: boolean): Promise<Attempt> {
  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'application/json', 'X-Title': 'Veracity' },
      body: JSON.stringify({ model, messages, temperature: 0.2, ...(stream ? { stream: true } : {}) }),
    });
  } catch (e) {
    return { ok: false, retryable: false, error: `réseau (${(e as Error).message})` };
  }
  if (res.status === 401) throw new UserError('config', 'Clé OpenRouter refusée : vérifie-la dans les options.');
  if (res.status === 429) {
    if (/per-day/i.test(await res.text())) {
      throw new UserError('quota', 'Quota gratuit du jour atteint (50 requêtes OpenRouter). Réessaie demain ou ajoute des crédits.');
    }
    return { ok: false, retryable: true, error: 'saturé (429)' };
  }
  if (!res.ok) return { ok: false, retryable: false, error: `HTTP ${res.status}` };
  return { ok: true, res };
}

/**
 * Essaie chaque modèle dans l'ordre : un nouvel essai après un 429, une demande de
 * correction si le JSON ne respecte pas le schéma, puis le modèle suivant.
 */
export async function chatJson<T>(
  opts: LlmOptions,
  messages: ChatMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<{ data: T; model: string }> {
  const sleep = opts.sleep ?? defaultSleep;
  const errors: string[] = [];
  for (const model of opts.models) {
    let conversation = messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const sent = await post(opts, model, conversation, false);
      if (!sent.ok) {
        errors.push(`${model}: ${sent.error}`);
        if (sent.retryable && attempt === 0) {
          await sleep(opts.retryDelayMs ?? 5000);
          continue;
        }
        break;
      }
      const payload = await sent.res.json();
      if (payload.error) {
        errors.push(`${model}: ${payload.error.message ?? 'erreur'}`);
        break;
      }
      const content: string = payload.choices?.[0]?.message?.content ?? '';
      let problem: string;
      try {
        const parsed = schema.safeParse(extractJson(content));
        if (parsed.success) return { data: parsed.data, model };
        problem = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
      } catch (e) {
        problem = (e as Error).message;
      }
      errors.push(`${model}: JSON invalide (${problem})`);
      conversation = [
        ...messages,
        { role: 'assistant', content },
        { role: 'user', content: `Ta réponse n'est pas un JSON valide pour le schéma demandé (${problem}). Renvoie UNIQUEMENT le JSON corrigé, sans texte autour.` },
      ];
    }
  }
  throw new UserError('llm', `Analyse impossible, tous les modèles ont échoué : ${errors.join(' | ')}`);
}

/** Lit un flux SSE OpenRouter et transmet chaque morceau de texte au fil de l'eau. */
export async function readSse(res: Response, onDelta: (delta: string) => void): Promise<string> {
  if (!res.body) throw new Error('flux vide');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  const handle = (line: string): boolean => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    const json = JSON.parse(data);
    if (json.error) throw new Error(json.error.message ?? 'erreur du fournisseur');
    const delta: string | undefined = json.choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }
    return false;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (handle(line)) {
        void reader.cancel();
        return text;
      }
    }
  }
  handle(buffer.trim());
  return text;
}

/** Réponse en streaming ; repli sur le modèle suivant seulement tant que rien n'a été affiché. */
export async function chatStream(
  opts: LlmOptions,
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
): Promise<{ text: string; model: string }> {
  const sleep = opts.sleep ?? defaultSleep;
  const errors: string[] = [];
  for (const model of opts.models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const sent = await post(opts, model, messages, true);
      if (!sent.ok) {
        errors.push(`${model}: ${sent.error}`);
        if (sent.retryable && attempt === 0) {
          await sleep(opts.retryDelayMs ?? 5000);
          continue;
        }
        break;
      }
      let received = false;
      try {
        const text = await readSse(sent.res, (d) => {
          received = true;
          onDelta(d);
        });
        if (text.trim()) return { text, model };
        errors.push(`${model}: réponse vide`);
      } catch (e) {
        if (received) throw new UserError('llm', `Réponse interrompue : ${(e as Error).message}`);
        errors.push(`${model}: ${(e as Error).message}`);
      }
      break;
    }
  }
  throw new UserError('llm', `Réponse impossible, tous les modèles ont échoué : ${errors.join(' | ')}`);
}
