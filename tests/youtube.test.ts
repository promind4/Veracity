import { describe, expect, it, vi } from 'vitest';
import { chooseTrack, fetchVideo, formatTime, formatTranscript, groupSegments, parseJson3, parseVideoId } from '../core/youtube';
import { UserError } from '../core/types';

describe('parseVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/feed/subscriptions', null],
    ['pas une url', null],
  ])('%s → %s', (input, expected) => {
    expect(parseVideoId(input)).toBe(expected);
  });
});

describe('chooseTrack', () => {
  const t = (languageCode: string, kind?: string) => ({ baseUrl: languageCode + (kind ?? ''), languageCode, kind });
  it('préfère la piste manuelle dans la langue parlée (déduite de la piste auto)', () => {
    expect(chooseTrack([t('de'), t('en'), t('en', 'asr')])?.baseUrl).toBe('en');
  });
  it('prend la piste auto si aucune piste manuelle dans cette langue', () => {
    expect(chooseTrack([t('de'), t('fr', 'asr')])?.baseUrl).toBe('frasr');
  });
  it('sans piste auto, préfère fr puis en', () => {
    expect(chooseTrack([t('de'), t('en-US'), t('fr-CA')])?.languageCode).toBe('fr-CA');
  });
  it('renvoie undefined sans piste', () => {
    expect(chooseTrack([])).toBeUndefined();
  });
});

describe('parseJson3', () => {
  it('extrait les segments non vides, au dixième de seconde', () => {
    const json = { events: [{ tStartMs: 0 }, { tStartMs: 1500, segs: [{ utf8: 'Bonjour ' }, { utf8: ' à\ntous' }] }, { tStartMs: 3000, segs: [{ utf8: '\n' }] }] };
    expect(parseJson3(json)).toEqual([{ start: 1.5, text: 'Bonjour à tous' }]);
  });
});

describe('formatTime', () => {
  it('formate m:ss et h:mm:ss', () => {
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(3605)).toBe('1:00:05');
  });
});

describe('formatTranscript', () => {
  it('regroupe les segments par blocs de 20 s', () => {
    const segs = [{ start: 0, text: 'a' }, { start: 5, text: 'b' }, { start: 25, text: 'c' }];
    expect(formatTranscript(segs)).toEqual({ text: '[0:00] a b\n[0:25] c', truncated: false });
  });
  it('tronque au-delà de la limite', () => {
    expect(formatTranscript([{ start: 0, text: 'abcdef' }], 5)).toEqual({ text: '[0:00', truncated: true });
  });
});

describe('groupSegments', () => {
  it('fusionne les segments par fenêtre', () => {
    expect(groupSegments([{ start: 0, text: 'a' }, { start: 29, text: 'b' }, { start: 31, text: 'c' }], 30)).toEqual([
      { start: 0, text: 'a b' },
      { start: 31, text: 'c' },
    ]);
  });
});

describe('fetchVideo', () => {
  const player = {
    playabilityStatus: { status: 'OK' },
    videoDetails: { title: 'Titre', author: 'Chaîne', shortDescription: 'Desc', lengthSeconds: '120' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://yt/caps?x=1&fmt=srv3', languageCode: 'fr', kind: 'asr' }] } },
  };
  it('assemble la vidéo à partir du player et de la piste json3', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/player')
        ? new Response(JSON.stringify(player))
        : new Response(JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: 'Salut' }] }] })),
    );
    const video = await fetchVideo('abcdefghijk', fetchFn as typeof fetch);
    expect(String(fetchFn.mock.calls[1][0])).toBe('https://yt/caps?x=1&fmt=json3');
    expect(video).toEqual({ videoId: 'abcdefghijk', title: 'Titre', author: 'Chaîne', description: 'Desc', durationS: 120, language: 'fr', segments: [{ start: 0, text: 'Salut' }], transcriptSource: 'captions' });
  });
  it('lève no_captions sans piste', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ...player, captions: undefined })));
    await expect(fetchVideo('abcdefghijk', fetchFn as typeof fetch)).rejects.toMatchObject({ code: 'no_captions' });
  });
  it('explique le blocage anti-robot de YouTube (réponse HTML)', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>Sorry... automated queries</html>', { status: 200 }));
    await expect(fetchVideo('abcdefghijk', fetchFn as typeof fetch)).rejects.toMatchObject({ code: 'unavailable', message: expect.stringContaining('anti-robot') });
  });
  it('lève unavailable pour une vidéo privée', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Vidéo privée' } })));
    await expect(fetchVideo('abcdefghijk', fetchFn as typeof fetch)).rejects.toBeInstanceOf(UserError);
  });
});
