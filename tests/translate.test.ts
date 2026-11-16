import { describe, expect, it, vi } from 'vitest';
import { buildTranslatePrompt, parseNumbered, translateCues, translationEngine } from '../core/translate';

const cues = [
  { start: 0, end: 2, text: 'Hello everyone.' },
  { start: 2, end: 5, text: 'Today we talk about agents.' },
  { start: 5, end: 8, text: 'Let us go.' },
];

describe('parseNumbered', () => {
  it('lit les lignes numérotées et ignore le reste', () => {
    expect(parseNumbered('Voici :\n[1] Bonjour\n[2]   \n [3] Allons-y')).toEqual(
      new Map([
        [1, 'Bonjour'],
        [3, 'Allons-y'],
      ]),
    );
  });
});

describe('buildTranslatePrompt', () => {
  it('numérote les sous-titres et donne le contexte', () => {
    const prompt = buildTranslatePrompt(
      [
        { n: 4, text: 'Hello' },
        { n: 5, text: 'World' },
      ],
      'fr',
      'Ma vidéo',
      ['Précédent'],
    );
    expect(prompt).toContain('en français');
    expect(prompt).toContain('[4] Hello\n[5] World');
    expect(prompt).toContain('Précédent');
    expect(prompt).toContain('Ma vidéo');
  });
});

describe('translateCues', () => {
  it('traduit par lots, garde les horodatages et l’original, signale les manques', async () => {
    const engine = vi
      .fn()
      .mockResolvedValueOnce({ text: '[1] Bonjour à tous.\n[2] Aujourd’hui, parlons des agents.', model: 'm' })
      .mockResolvedValueOnce({ text: 'rien', model: 'm' });
    const progress: string[] = [];
    const out = await translateCues(cues, 'fr', 'Titre', engine, { batchSize: 2, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(out.cues).toEqual([
      { start: 0, end: 2, text: 'Bonjour à tous.', orig: 'Hello everyone.' },
      { start: 2, end: 5, text: 'Aujourd’hui, parlons des agents.', orig: 'Today we talk about agents.' },
      { start: 5, end: 8, text: 'Let us go.', orig: 'Let us go.' },
    ]);
    expect(out.missing).toBe(1);
    expect(out.model).toBe('m');
    expect(progress).toEqual(['1/2', '2/2']);
    expect(engine.mock.calls[1][0]).toContain('Aujourd’hui, parlons des agents.');
  });
});

describe('translationEngine', () => {
  it('préfère Gemini quand une clé est disponible', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[1] Salut' }] } }] })));
    const engine = translationEngine({ geminiKey: 'g', openrouterKey: 'o', models: ['x'] }, fetchFn);
    expect(await engine('prompt')).toEqual({ text: '[1] Salut', model: 'gemini-flash-lite-latest' });
    expect(String(fetchFn.mock.calls[0][0])).toContain('generativelanguage.googleapis.com');
  });
  it('se replie sur OpenRouter sans clé Gemini', async () => {
    const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: '[1] Salut' } }] })}\n\ndata: [DONE]\n\n`;
    const fetchFn = vi.fn().mockResolvedValue(new Response(sse));
    const engine = translationEngine({ openrouterKey: 'o', models: ['x'] }, fetchFn);
    expect(await engine('prompt')).toEqual({ text: '[1] Salut', model: 'x' });
  });
  it('exige une clé', () => {
    expect(() => translationEngine({ openrouterKey: '', models: [] })).toThrow(/clé/i);
  });
});
