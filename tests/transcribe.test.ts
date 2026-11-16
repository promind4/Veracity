import { describe, expect, it, vi } from 'vitest';
import { parseTimedLines, transcribeYouTube } from '../core/transcribe';
import { fetchVideo } from '../core/youtube';

describe('parseTimedLines', () => {
  it('lit la langue, les horodatages, trie et borne à la durée', () => {
    const text = 'LANGUE: FR\n[0:05] Bonjour\nbruit sans horodatage\n[0:00] Début\n[1:00:00] Hors durée\n[0:30]   \n[0:20] Suite';
    expect(parseTimedLines(text, 120)).toEqual({
      language: 'fr',
      segments: [
        { start: 0, text: 'Début' },
        { start: 5, text: 'Bonjour' },
        { start: 20, text: 'Suite' },
        { start: 120, text: 'Hors durée' },
      ],
    });
  });
  it('utilise fr par défaut', () => {
    expect(parseTimedLines('[0:01] a', 10).language).toBe('fr');
  });
});

const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const noSleep = async () => {};

describe('transcribeYouTube', () => {
  it('envoie le lien YouTube et passe au modèle suivant si le premier est saturé ou interdit', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
      .mockResolvedValueOnce(gemini('LANGUE: en\n[0:01] Hello'));
    const out = await transcribeYouTube({ videoId: 'abc', durationS: 60 }, { key: 'k', models: ['a', 'b', 'c'], fetchFn, sleep: noSleep });
    expect(out).toEqual({ language: 'en', segments: [{ start: 1, text: 'Hello' }], model: 'c' });
    const [url, init] = fetchFn.mock.calls[3];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/c:generateContent');
    expect(init.headers['X-goog-api-key']).toBe('k');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0]).toEqual({ fileData: { fileUri: 'https://www.youtube.com/watch?v=abc' }, videoMetadata: { fps: 0.1 } });
    expect(body.contents[0].parts[1].text).toContain('1:00');
  });
  it('explique une vidéo illisible par Gemini (privée, non répertoriée)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad"}}', { status: 400 }));
    await expect(transcribeYouTube({ videoId: 'abc', durationS: 60 }, { key: 'k', models: ['a'], fetchFn, sleep: noSleep })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('signale une clé refusée', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":{"message":"API key not valid"}}', { status: 400 }));
    await expect(transcribeYouTube({ videoId: 'abc', durationS: 60 }, { key: 'k', models: ['a'], fetchFn, sleep: noSleep })).rejects.toMatchObject({ code: 'config' });
  });
  it('échoue si la réponse ne contient aucune ligne horodatée', async () => {
    const fetchFn = vi.fn().mockResolvedValue(gemini('Je ne peux pas.'));
    await expect(transcribeYouTube({ videoId: 'abc', durationS: 60 }, { key: 'k', models: ['a'], fetchFn, sleep: noSleep })).rejects.toMatchObject({ code: 'llm' });
  });
});

describe('fetchVideo sans sous-titres', () => {
  const player = { playabilityStatus: { status: 'OK' }, videoDetails: { title: 'T', author: 'A', shortDescription: '', lengthSeconds: '60' } };
  it('utilise la transcription de secours', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(player)));
    const fallback = vi.fn(async () => ({ language: 'en', segments: [{ start: 0, text: 'Hi' }] }));
    const video = await fetchVideo('abcdefghijk', fetchFn as typeof fetch, 'fr', fallback);
    expect(fallback).toHaveBeenCalledWith({ videoId: 'abcdefghijk', durationS: 60 });
    expect(video).toMatchObject({ language: 'en', segments: [{ start: 0, text: 'Hi' }], transcriptSource: 'gemini', title: 'T' });
  });
  it('sans secours, indique comment activer la transcription audio', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(player)));
    await expect(fetchVideo('abcdefghijk', fetchFn as typeof fetch)).rejects.toMatchObject({ code: 'no_captions', message: expect.stringContaining('Gemini') });
  });
});
