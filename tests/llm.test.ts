import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chatJson } from '../core/llm';

const schema = z.object({ ok: z.boolean() });
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
const noSleep = async () => {};

describe('chatJson', () => {
  it('passe au modèle suivant après deux 429', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(completion('{"ok":true}'));
    const out = await chatJson({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [{ role: 'user', content: 'x' }], schema);
    expect(out).toEqual({ data: { ok: true }, model: 'b' });
    expect(JSON.parse(fetchFn.mock.calls[2][1].body).model).toBe('b');
  });

  it('redemande un JSON corrigé une fois', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(completion('pas du json')).mockResolvedValueOnce(completion('{"ok":false}'));
    const out = await chatJson({ key: 'k', models: ['a'], fetchFn, sleep: noSleep }, [{ role: 'user', content: 'x' }], schema);
    expect(out.data).toEqual({ ok: false });
    const retryMessages = JSON.parse(fetchFn.mock.calls[1][1].body).messages;
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[2].content).toContain('JSON');
  });

  it('signale le quota journalier', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('Rate limit exceeded: free-models-per-day', { status: 429 }));
    await expect(chatJson({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [], schema)).rejects.toMatchObject({ code: 'quota' });
  });

  it('signale une clé refusée', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    await expect(chatJson({ key: 'k', models: ['a'], fetchFn, sleep: noSleep }, [], schema)).rejects.toMatchObject({ code: 'config' });
  });

  it('échoue avec le détail quand tous les modèles échouent', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    await expect(chatJson({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [], schema)).rejects.toThrow(/a: HTTP 500 \| b: HTTP 500/);
  });
});
