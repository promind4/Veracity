// Moteurs d'analyse « JSON » interchangeables : Gemini (puissant, quota large) d'abord, OpenRouter en secours.

import type { z } from 'zod';
import { GEMINI_ANALYSIS_MODELS, geminiGenerate, geminiKeys } from './gemini';
import { type ChatMessage, chatJson, chatStream, type LlmOptions } from './llm';
import { extractJson } from './schema';
import { type Config, DEFAULT_MODELS, type FetchFn, UserError } from './types';

export interface JsonCallOptions {
  /** Remplace la température du moteur (utilisé pour varier les passages de vérification). */
  temperature?: number;
}

export type JsonEngine = <T>(
  messages: ChatMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  opts?: JsonCallOptions,
) => Promise<{ data: T; model: string }>;

export const openrouterEngine =
  (llm: LlmOptions): JsonEngine =>
  (messages, schema) =>
    chatJson(llm, messages, schema);

export interface GeminiEngineOptions {
  key: string | string[];
  models?: string[];
  fetchFn?: FetchFn;
  temperature?: number;
  attempts?: number;
}

/** Le texte de la conversation, d'un seul bloc (Gemini reçoit consignes et données ensemble). */
export const messagesToPrompt = (messages: ChatMessage[]) => messages.map((m) => m.content).join('\n\n');

export const geminiEngine =
  (opts: GeminiEngineOptions): JsonEngine =>
  async (messages, schema, callOpts) => {
    let parsed: unknown;
    const accept = (text: string) => {
      try {
        const result = schema.safeParse(extractJson(text));
        if (result.success) parsed = result.data;
        return result.success;
      } catch {
        return false;
      }
    };
    const { model } = await geminiGenerate(
      [{ text: messagesToPrompt(messages) }],
      {
        key: opts.key,
        models: opts.models ?? GEMINI_ANALYSIS_MODELS,
        fetchFn: opts.fetchFn,
        attempts: opts.attempts ?? 4,
        generationConfig: { temperature: callOpts?.temperature ?? opts.temperature ?? 0, responseMimeType: 'application/json', maxOutputTokens: 32768 },
        failurePrefix: 'Analyse impossible avec Gemini',
      },
      accept,
    );
    return { data: parsed as never, model };
  };

/** Moteur de l'analyse : Gemini si une clé existe (repli sur OpenRouter en cas d'échec), sinon OpenRouter. */
export function analysisEngine(config: Pick<Config, 'geminiKey' | 'geminiKey2' | 'openrouterKey' | 'models'>, fetchFn?: FetchFn): JsonEngine {
  const openrouter = config.openrouterKey
    ? openrouterEngine({ key: config.openrouterKey, models: config.models.length ? config.models : DEFAULT_MODELS, fetchFn })
    : null;
  if (!config.geminiKey && !openrouter) {
    throw new UserError('config', 'Aucune clé pour l’analyse : ajoute une clé Gemini (gratuite) ou OpenRouter dans les options.');
  }
  if (!config.geminiKey) return openrouter!;
  const gemini = geminiEngine({ key: geminiKeys(config), fetchFn });
  if (!openrouter) return gemini;
  return async (messages, schema, callOpts) => {
    try {
      return await gemini(messages, schema, callOpts);
    } catch (e) {
      if (e instanceof UserError && (e.code === 'llm' || e.code === 'config')) return openrouter(messages, schema);
      throw e;
    }
  };
}

/**
 * Réponse en texte libre (discussion, tuteur) : Gemini d'abord (rapide, quota à part, la réponse arrive d'un bloc),
 * OpenRouter en streaming sinon ou si Gemini est indisponible.
 */
export async function answerText(
  messages: ChatMessage[],
  config: Pick<Config, 'geminiKey' | 'geminiKey2' | 'openrouterKey' | 'models'>,
  onDelta: (delta: string) => void,
  fetchFn?: FetchFn,
): Promise<{ text: string; model: string }> {
  if (config.geminiKey) {
    const turns = messages.map((m) => (m.role === 'system' ? m.content : `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content}`));
    const prompt = `${turns.join('\n\n')}\n\nAssistant :`;
    try {
      const out = await geminiGenerate([{ text: prompt }], {
        key: geminiKeys(config),
        models: GEMINI_ANALYSIS_MODELS,
        attempts: 3,
        fetchFn,
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
        failurePrefix: 'Réponse impossible',
      });
      onDelta(out.text);
      return out;
    } catch (e) {
      if (!(e instanceof UserError && (e.code === 'llm' || e.code === 'config') && config.openrouterKey)) throw e;
    }
  }
  if (!config.openrouterKey) throw new UserError('config', 'Aucune clé pour répondre : ajoute une clé Gemini (gratuite) ou OpenRouter dans les options.');
  return chatStream({ key: config.openrouterKey, models: config.models.length ? config.models : DEFAULT_MODELS, fetchFn }, messages, onDelta);
}
