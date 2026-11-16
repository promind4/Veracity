import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geminiGenerate, parseRetryDelay, resetQuotaMemory } from '../core/gemini';

const quota429 = (retry: string) =>
  new Response(JSON.stringify({ error: { message: `You exceeded your current quota, limit: 20, model: gemini-x\nPlease retry in ${retry}.` } }), { status: 429 });
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

beforeEach(() => resetQuotaMemory());

describe('parseRetryDelay', () => {
  it('lit les durées de Google', () => {
    expect(parseRetryDelay('Please retry in 10h5m48.9s.')).toBeCloseTo(10 * 3_600_000 + 5 * 60_000 + 48_900, -2);
    expect(parseRetryDelay('retry in 32s')).toBe(32_000);
    expect(parseRetryDelay('rien')).toBeNull();
  });
});

describe('geminiGenerate : quota du jour', () => {
  it('passe au modèle suivant sans réessayer ni attendre quand le quota du jour est épuisé', async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn(async (url: string) => (url.includes('modele-a') ? quota429('10h5m48s') : ok('réponse')));
    const out = await geminiGenerate([{ text: 'x' }], { key: 'k', models: ['modele-a', 'modele-b'], fetchFn: fetchFn as unknown as typeof fetch, sleep });
    expect(out).toEqual({ text: 'réponse', model: 'modele-b' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('se souvient du modèle épuisé et ne l’appelle plus', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('modele-a') ? quota429('3h') : ok('ok')));
    const opts = { key: 'k', models: ['modele-a', 'modele-b'], fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {} };
    await geminiGenerate([{ text: 'x' }], opts);
    await geminiGenerate([{ text: 'x' }], opts);
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes('modele-a'))).toHaveLength(1);
  });
  it('réessaie après une saturation courte', async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn().mockResolvedValueOnce(quota429('7s')).mockResolvedValueOnce(ok('ok'));
    const out = await geminiGenerate([{ text: 'x' }], { key: 'k', models: ['modele-c'], fetchFn: fetchFn as unknown as typeof fetch, sleep });
    expect(out.text).toBe('ok');
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it('signale clairement quand tous les modèles sont épuisés', async () => {
    const fetchFn = vi.fn(async () => quota429('9h'));
    await expect(geminiGenerate([{ text: 'x' }], { key: 'k', models: ['m1', 'm2'], fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {} })).rejects.toThrow(/quota du jour épuisé/);
  });
});

describe('geminiGenerate : plusieurs clés', () => {
  const keyOf = (init?: RequestInit) => (init?.headers as Record<string, string>)['X-goog-api-key'];
  it('bascule sur la clé de secours quand le quota de la première est épuisé, sans attendre', async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => (keyOf(init) === 'cle-principale' ? quota429('9h') : ok('depuis le secours')));
    const out = await geminiGenerate([{ text: 'x' }], { key: ['cle-principale', 'cle-secours'], models: ['m-multi'], fetchFn: fetchFn as unknown as typeof fetch, sleep });
    expect(out).toEqual({ text: 'depuis le secours', model: 'm-multi' });
    expect(fetchFn.mock.calls.map(([, init]) => keyOf(init))).toEqual(['cle-principale', 'cle-secours']);
    expect(sleep).not.toHaveBeenCalled();
  });
  it('se souvient que la clé principale est épuisée pour ce modèle', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => (keyOf(init) === 'cle-principale' ? quota429('9h') : ok('ok')));
    const opts = { key: ['cle-principale', 'cle-secours'], models: ['m-memoire'], fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {} };
    await geminiGenerate([{ text: 'x' }], opts);
    await geminiGenerate([{ text: 'x' }], opts);
    expect(fetchFn.mock.calls.filter(([, init]) => keyOf(init) === 'cle-principale')).toHaveLength(1);
    expect(fetchFn.mock.calls.filter(([, init]) => keyOf(init) === 'cle-secours')).toHaveLength(2);
  });
  it('essaie les deux clés avant de passer au modèle suivant', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => (url.includes('premier') ? quota429('9h') : ok(`${keyOf(init)}`)));
    const out = await geminiGenerate([{ text: 'x' }], { key: ['a-cle-1', 'a-cle-2'], models: ['premier', 'second'], fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {} });
    expect(out.model).toBe('second');
    expect(fetchFn.mock.calls.map(([u, init]) => `${String(u).includes('premier') ? 'premier' : 'second'}/${keyOf(init)}`)).toEqual(['premier/a-cle-1', 'premier/a-cle-2', 'second/a-cle-1']);
  });
  it('ignore une clé refusée si l’autre fonctionne, mais signale l’erreur quand toutes sont refusées', async () => {
    const refused = () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => (keyOf(init) === 'mauvaise' ? refused() : ok('bonne clé')));
    expect((await geminiGenerate([{ text: 'x' }], { key: ['mauvaise', 'bonne'], models: ['m-refus'], fetchFn: fetchFn as unknown as typeof fetch })).text).toBe('bonne clé');
    await expect(geminiGenerate([{ text: 'x' }], { key: ['mauvaise'], models: ['m-refus-2'], fetchFn: (async () => refused()) as unknown as typeof fetch })).rejects.toThrow(/Clé Gemini refusée/);
  });
});
