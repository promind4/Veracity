import type { JsonEngine } from './engine';
import { extractJson } from './schema';
import { UserError, type FetchFn } from './types';

export function directEngine(provider: 'openai' | 'anthropic', key: string, model: string, fetchFn: FetchFn = fetch): JsonEngine {
  return async (messages, schema) => {
    const isClaude = provider === 'anthropic';
    const url = isClaude ? 'https://api.anthropic.com/v1/messages' : 'https://api.openai.com/v1/chat/completions';
    const headers: Record<string, string> = isClaude
      ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
      : { 'content-type': 'application/json', Authorization: `Bearer ${key}` };
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const body = isClaude
      ? { model, max_tokens: 16000, system, messages: messages.filter((m) => m.role !== 'system') }
      : { model, messages };
    let response: Response;
    try { response = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
    catch { throw new UserError('llm', `Connexion ${provider} impossible.`); }
    if (!response.ok) throw new UserError('llm', `${provider} : HTTP ${response.status}.`);
    const payload = await response.json();
    const text = isClaude ? (payload.content ?? []).filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('') : payload.choices?.[0]?.message?.content;
    try { return { data: schema.parse(extractJson(text ?? '')), model: payload.model ?? model }; }
    catch { throw new UserError('llm', `Réponse ${provider} invalide.`); }
  };
}
