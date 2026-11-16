import { describe, expect, it, vi } from 'vitest';
import { chatStream, readSse } from '../core/llm';

const sse = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  );
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const noSleep = async () => {};

describe('readSse', () => {
  it('assemble les morceaux, même coupés au milieu d’une ligne, et ignore les commentaires', async () => {
    const full = `: OPENROUTER PROCESSING\n\n${delta('Bon')}${delta('jour')}data: [DONE]\n\n`;
    const chunks: string[] = [];
    const text = await readSse(sse(full.slice(0, 30), full.slice(30, 61), full.slice(61)), (d) => chunks.push(d));
    expect(text).toBe('Bonjour');
    expect(chunks).toEqual(['Bon', 'jour']);
  });
  it('lève une erreur transmise dans le flux', async () => {
    await expect(readSse(sse(`data: {"error":{"message":"boom"}}\n\n`), () => {})).rejects.toThrow('boom');
  });
});

describe('chatStream', () => {
  it('passe au modèle suivant si le premier est saturé', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(sse(delta('ok'), 'data: [DONE]\n\n'));
    const out = await chatStream({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [], () => {});
    expect(out).toEqual({ text: 'ok', model: 'b' });
    expect(JSON.parse(fetchFn.mock.calls[2][1].body).stream).toBe(true);
  });
  it('passe au modèle suivant si la réponse est vide', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(sse('data: [DONE]\n\n')).mockResolvedValueOnce(sse(delta('salut')));
    expect(await chatStream({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [], () => {})).toEqual({ text: 'salut', model: 'b' });
  });
  it('ne mélange pas deux réponses : erreur si coupure après le premier mot', async () => {
    const fetchFn = vi.fn().mockResolvedValue(sse(delta('début'), `data: {"error":{"message":"coupé"}}\n\n`));
    await expect(chatStream({ key: 'k', models: ['a', 'b'], fetchFn, sleep: noSleep }, [], () => {})).rejects.toMatchObject({ code: 'llm', message: expect.stringContaining('interrompue') });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
