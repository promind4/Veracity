import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { analysisEngine } from '../core/engine';
import { gatherEvidence } from '../core/evidence/gather';
import type { Claim, Config } from '../core/types';

const config: Config = { geminiKey: 'g', openrouterKey: 'o', models: ['model-o'], geminiModels: ['model-g'] };
const schema = z.object({ ok: z.boolean() });

describe('priorité des fournisseurs', () => {
  it('envoie le premier modèle OpenRouter configuré quand ce fournisseur est prioritaire', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const result = await analysisEngine({ ...config, models: ['premier/modele', 'second/modele'], analysisProviderOrder: ['openrouter', 'gemini'] }, fetchFn)([], schema);
    expect(JSON.parse(String(fetchFn.mock.calls[0][1]?.body)).model).toBe('premier/modele');
    expect(result.model).toBe('premier/modele');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it('adresse la clé Anthropic au bon service et interprète sa réponse', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ model: 'claude-test', content: [{ type: 'text', text: '{"ok":true}' }] })));
    const result = await analysisEngine({ ...config, anthropicKey: 'test-key', anthropicModel: 'claude-test', analysisProviderOrder: ['anthropic', 'gemini'] }, fetchFn)([{ role: 'user', content: 'test' }], schema);
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://api.anthropic.com/v1/messages');
    expect((fetchFn.mock.calls[0][1]?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    expect(result.data.ok).toBe(true);
  });
  it('respecte OpenRouter en premier et revient à Gemini si sa clé est refusée', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).includes('openrouter')
      ? new Response('refused', { status: 401 })
      : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })));
    const result = await analysisEngine({ ...config, analysisProviderOrder: ['openrouter', 'gemini'] }, fetchFn)([], schema);
    expect(String(fetchFn.mock.calls[0][0])).toContain('openrouter');
    expect(String(fetchFn.mock.calls[1][0])).toContain('model-g');
    expect(result).toEqual({ data: { ok: true }, model: 'model-g' });
  });
  it('accepte uniquement la deuxième clé Gemini et ne contacte pas OpenRouter après un succès', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] })));
    await analysisEngine({ ...config, geminiKey: undefined, geminiKey2: 'second' }, fetchFn)([], schema);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('generativelanguage');
  });
});

describe('services de recherche activés', () => {
  it('exclut ScraperAPI même avec une clé et compte les appels effectués', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ organic: [{ link: 'https://source.example', snippet: 'preuve' }] })));
    const claim = { id: 'C1', type: 'fait', queries: ['test'] } as Claim;
    const result = await gatherEvidence([claim], { serperKey: 's', scraperapiKey: 'secret', searchProviderOrder: ['serper'] }, 'fr', { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual({ Serper: { requests: 1, failed: 0 } });
    expect(String(fetchFn.mock.calls[0][0])).toContain('google.serper.dev');
  });
  it('le mode économique ne combine pas tous les moteurs pour une annonce récente', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => String(url).includes('r.jina.ai')
      ? new Response(JSON.stringify({ data: { content: 'Page source' } }))
      : new Response(JSON.stringify({ organic: [{ link: 'https://source.example', snippet: 'Annonce' }] })));
    const claim = { id: 'C1', type: 'fait', queries: ['test'], timeSensitive: true } as Claim;
    const result = await gatherEvidence([claim], { serperKey: 's', jinaKey: 'j', scraperapiKey: 'k', recentSearchMode: 'fallback' }, 'fr', { fetchFn });
    expect(result.usage.Jina).toBeUndefined();
    expect(result.usage.ScraperAPI).toBeUndefined();
    expect(result.usage.Serper.requests).toBe(2);
  });
});
