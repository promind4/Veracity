import { factCheckSearch } from './evidence/factcheck';
import { jinaSearch } from './evidence/jina';
import { serperSearch } from './evidence/serper';
import type { Config, FetchFn } from './types';

export interface KeyStatus {
  ok: boolean | null;
  message: string;
}

export async function testKeys(config: Partial<Config>, fetchFn: FetchFn = fetch): Promise<Record<string, KeyStatus>> {
  const run = async (key: string | undefined, check: (k: string) => Promise<string>): Promise<KeyStatus> => {
    if (!key) return { ok: null, message: 'non renseignée' };
    try {
      return { ok: true, message: await check(key) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };
  const checkGemini = async (k: string) => {
    const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'X-goog-api-key': k } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return 'OK';
  };
  const [openrouter, serper, jina, factcheck, scraperapi, gemini, gemini2] = await Promise.all([
    run(config.openrouterKey, async (k) => {
      const res = await fetchFn('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${k}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const free = (await res.json()).data?.free_model_daily_requests;
      return free ? `${free.remaining}/${free.limit} requêtes gratuites restantes aujourd'hui` : 'OK';
    }),
    run(config.serperKey, async (k) => `${(await serperSearch('test', k, 'fr', fetchFn)).length} résultats`),
    run(config.jinaKey, async (k) => `${(await jinaSearch('test', k, fetchFn)).length} résultats`),
    run(config.factcheckKey, async (k) => {
      await factCheckSearch('vaccin', k, 'fr', fetchFn);
      return 'OK';
    }),
    run(config.scraperapiKey, async (k) => {
      const res = await fetchFn(`https://api.scraperapi.com/account?api_key=${encodeURIComponent(k)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      return `${d.requestLimit - d.requestCount} crédits restants`;
    }),
    run(config.geminiKey, checkGemini),
    run(config.geminiKey2, checkGemini),
  ]);
  return { OpenRouter: openrouter, Serper: serper, Jina: jina, 'Google Fact Check': factcheck, ScraperAPI: scraperapi, Gemini: gemini, 'Gemini (secours)': gemini2 };
}
