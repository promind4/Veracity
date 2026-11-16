import { describe, expect, it, vi } from 'vitest';
import { fitRate, planDubGroups } from '../core/dub';
import { geminiSpeak, pcmToWav, wavDuration } from '../core/tts-gemini';

const cue = (start: number, end: number, text: string) => ({ start, end, text });

describe('planDubGroups', () => {
  const cues = [cue(0, 3, 'Un.'), cue(3, 7, 'Deux.'), cue(8, 12, 'Trois.'), cue(30, 33, 'Quatre.')];
  it('garde une phrase par groupe quand maxS vaut 0 (synchronisation fine)', () => {
    expect(planDubGroups(cues, 0).map((g) => [g.start, g.end, g.text])).toEqual([
      [0, 3, 'Un.'],
      [3, 7, 'Deux.'],
      [8, 12, 'Trois.'],
      [30, 33, 'Quatre.'],
    ]);
  });
  it('regroupe les phrases proches jusqu’à maxS, sans enjamber un long silence', () => {
    expect(planDubGroups(cues, 10).map((g) => [g.start, g.end, g.text])).toEqual([
      [0, 7, 'Un. Deux.'],
      [8, 12, 'Trois.'],
      [30, 33, 'Quatre.'],
    ]);
  });
  it('donne à chaque groupe la fenêtre disponible jusqu’au groupe suivant', () => {
    const groups = planDubGroups(cues, 0);
    expect(groups.map((g) => g.window)).toEqual([3, 5, 22, 3]);
  });
});

describe('fitRate', () => {
  it('ne ralentit jamais et accélère au plus de 60 %', () => {
    expect(fitRate(2, 4)).toBe(1);
    expect(fitRate(5, 4)).toBe(1.25);
    expect(fitRate(10, 4)).toBe(1.6);
    expect(fitRate(3, 0)).toBe(1.6);
  });
});

describe('WAV', () => {
  it('ajoute un en-tête et calcule la durée', () => {
    const wav = pcmToWav(new Uint8Array(48000), 24000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(48044);
    expect(wavDuration(wav)).toBe(1);
  });
});

describe('geminiSpeak', () => {
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
  it('demande la voix choisie et convertit le PCM brut en WAV', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64(new Uint8Array(24000)) } }] } }] })),
    );
    const out = await geminiSpeak('Bonjour', { key: 'k', voice: 'Charon', models: ['m'], lang: 'fr', fetchFn });
    expect(out.durationS).toBe(0.5);
    expect(new TextDecoder().decode(out.wav.subarray(0, 4))).toBe('RIFF');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon');
    expect(body.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(body.contents[0].parts[0].text).toContain('Bonjour');
  });
  it('garde tel quel un WAV complet', async () => {
    const wav = pcmToWav(new Uint8Array(48000), 24000);
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: b64(wav) } }] } }] })));
    const out = await geminiSpeak('Salut', { key: 'k', voice: 'Kore', models: ['m'], lang: 'fr', fetchFn });
    expect(out.wav.length).toBe(48044);
    expect(out.durationS).toBe(1);
  });
  it('signale le quota épuisé', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(geminiSpeak('Salut', { key: 'k', voice: 'Kore', models: ['m'], lang: 'fr', fetchFn, sleep: async () => {} })).rejects.toMatchObject({ code: 'quota' });
  });
});

describe('geminiSpeak : un seul modèle par session', () => {
  it('réessaie plusieurs fois le même modèle saturé au lieu de changer de voix', async () => {
    const ok = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: Buffer.from(new Uint8Array(480)).toString('base64') } }] } }] }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(ok);
    const sleep = vi.fn(async (_ms: number) => {});
    const out = await geminiSpeak('Salut', { key: 'k', voice: 'Kore', lang: 'fr', models: ['m'], attempts: 4, fetchFn, sleep });
    expect(out.model).toBe('m');
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([3000, 6000, 9000]);
  });
});
