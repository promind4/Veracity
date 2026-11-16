import { describe, expect, it, vi } from 'vitest';
import {
  analyzeChannel,
  candidateOrder,
  channelIdFromHtml,
  channelToMarkdown,
  channelVideoOf,
  type ChannelVideo,
  type Feed,
  type FeedEntry,
  parseChannelUrl,
  parseFeed,
  summarizeChannel,
  verdictOf,
} from '../core/channel';
import type { Report } from '../core/types';

const ID = 'UC5q6wJ9ffFFz-laOT6bTPYA';
const XML = `<feed><title>ScienceEtonnante2</title><yt:channelId>${ID}</yt:channelId>
<entry><id>yt:video:AAAAAAAAAAA</id><yt:videoId>AAAAAAAAAAA</yt:videoId><yt:channelId>${ID}</yt:channelId><title>Vidéo &amp; co</title><published>2026-10-01T10:00:00+00:00</published>
<author><name>ScienceEtonnante2</name></author><media:group><media:community><media:statistics views="1200"/></media:community></media:group></entry>
<entry><yt:videoId>BBBBBBBBBBB</yt:videoId><title>Deux</title><published>2026-09-01T10:00:00+00:00</published></entry></feed>`;

describe('parseFeed', () => {
  it('lit le nom, l’identifiant, les vidéos, les dates et les vues', () => {
    const feed = parseFeed(XML);
    expect(feed).toMatchObject({ channelId: ID, name: 'ScienceEtonnante2' });
    expect(parseFeed(XML.replace(`<yt:channelId>${ID}</yt:channelId>
<entry>`, `<yt:channelId>${ID.slice(2)}</yt:channelId>
<entry>`)).channelId).toBe(ID);
    expect(feed.entries).toEqual([
      { videoId: 'AAAAAAAAAAA', title: 'Vidéo & co', published: '2026-10-01T10:00:00+00:00', views: 1200 },
      { videoId: 'BBBBBBBBBBB', title: 'Deux', published: '2026-09-01T10:00:00+00:00', views: undefined },
    ]);
  });
});

describe('parseChannelUrl / channelIdFromHtml', () => {
  it('reconnaît les adresses de chaîne', () => {
    expect(parseChannelUrl(`https://www.youtube.com/channel/${ID}/videos`)).toEqual({ channelId: ID });
    expect(parseChannelUrl('https://www.youtube.com/@ScienceEtonnante/videos')).toEqual({ handle: '@ScienceEtonnante' });
    expect(parseChannelUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseChannelUrl('https://exemple.com/@x')).toBeNull();
  });
  it('lit l’identifiant dans le code de la page', () => {
    expect(channelIdFromHtml(`<link rel="canonical" href="https://www.youtube.com/channel/${ID}">`)).toBe(ID);
    expect(channelIdFromHtml(`..."externalId":"${ID}"...`)).toBe(ID);
    expect(channelIdFromHtml('rien')).toBeNull();
  });
});

const entry = (i: number, views?: number): FeedEntry => ({ videoId: `V${String(i).padStart(10, '0')}`, title: `v${i}`, published: `2026-10-${String(30 - i).padStart(2, '0')}T00:00:00Z`, views });

describe('candidateOrder', () => {
  it('alterne les plus récentes et les plus vues, sans doublon', () => {
    const entries = [entry(0, 10), entry(1, 500), entry(2, 20), entry(3, 900)];
    expect(candidateOrder(entries).map((e) => e.title)).toEqual(['v0', 'v3', 'v1', 'v2']);
  });
});

const video = (facts: number | null, discourse: number, extra: Partial<ChannelVideo> = {}): ChannelVideo => ({
  videoId: 'x', title: 't', facts, discourse, label: 'l', verified: 8, techniques: [], ...extra,
});

describe('verdictOf', () => {
  it.each([
    [90, 85, 5, 'fiable'],
    [80, 50, 5, 'orientee'],
    [70, 65, 5, 'mitigee'],
    [30, 80, 5, 'peu_fiable'],
    [null, 30, 5, 'commerciale'],
    [50, 40, 5, 'commerciale'],
    [95, 95, 2, 'insuffisant'],
  ] as const)('faits %s, discours %s, %s vidéos → %s', (facts, discourse, n, expected) => {
    expect(verdictOf(facts, discourse, n)).toBe(expected);
  });
});

describe('summarizeChannel', () => {
  it('prend la médiane des vidéos évaluables et compte les autres', () => {
    const s = summarizeChannel([video(90, 80), video(70, 60), video(null, 40), video(80, 90)]);
    expect(s).toMatchObject({ facts: 80, discourse: 70, unevaluable: 1, spread: 20, outliers: [] });
  });
  it('une vidéo atypique ne fait pas basculer le verdict mais est signalée', () => {
    const s = summarizeChannel([video(27, 61, { videoId: 'a' }), video(93, 82, { videoId: 'b' }), video(95, 92, { videoId: 'c' })]);
    expect(s).toMatchObject({ facts: 93, verdict: 'fiable', outliers: ['a'] });
    expect(s.advice).toContain('1 vidéo(s) de l’échantillon sont nettement en dessous');
  });
  it('mais deux vidéos sur trois très faibles donnent bien une chaîne peu fiable', () => {
    expect(summarizeChannel([video(27, 61), video(30, 82), video(95, 92)]).verdict).toBe('peu_fiable');
  });
  it('classe les procédés les plus fréquents', () => {
    const s = summarizeChannel([video(50, 30, { techniques: ['urgence', 'rarete'] }), video(40, 30, { techniques: ['urgence'] }), video(null, 30, { techniques: ['urgence', 'conflit_interet'] })]);
    expect(s.techniques[0]).toEqual({ technique: 'urgence', videos: 3 });
    expect(s.verdict).toBe('commerciale');
  });
  it('la confiance dépend du nombre de vidéos, de leur écart et de la fiabilité de leurs notes', () => {
    const six = Array.from({ length: 6 }, () => video(80, 80));
    expect(summarizeChannel(six).confidence).toBe('haute');
    expect(summarizeChannel(six.slice(0, 4)).confidence).toBe('moyenne');
    expect(summarizeChannel(six.slice(0, 2)).confidence).toBe('faible');
    expect(summarizeChannel([...six.slice(0, 3), video(10, 80), video(95, 80), video(80, 80)]).confidence).toBe('moyenne');
    expect(summarizeChannel(six.map((v) => ({ ...v, reliability: 'faible' as const }))).confidence).toBe('moyenne');
  });
});

const report = (videoId: string, facts: number | null, discourse: number): Report =>
  ({
    version: 1, videoId, title: `Titre ${videoId}`, author: 'Chaîne', createdAt: '2026-10-13T00:00:00Z', models: [], summary: '', tags: [], claims: [], verdicts: [], evidence: [],
    rhetoric: [{ technique: 'urgence', timestampS: 0, quote: '', explanation: '' }], scores: { facts, discourse, coverage: 1, label: 'Fiable', reliability: 'haute' }, warnings: [],
  }) as Report;

describe('channelVideoOf', () => {
  it('résume un rapport pour la chaîne', () => {
    expect(channelVideoOf(report('a', 90, 80), '2026-10-01')).toMatchObject({ videoId: 'a', facts: 90, discourse: 80, techniques: ['urgence'], published: '2026-10-01' });
  });
});

describe('analyzeChannel', () => {
  const feed: Feed = { channelId: ID, name: 'Chaîne', entries: Array.from({ length: 8 }, (_, i) => entry(i, 100 - i)) };
  const base = () => ({
    fetchFeed: vi.fn(async () => feed),
    cachedReport: vi.fn(async (_id: string): Promise<Report | null> => null),
    analyze: vi.fn(async (e: FeedEntry): Promise<Report | { skip: string }> => report(e.videoId, 80, 80)),
    now: () => '2026-10-13T00:00:00Z',
  });
  it('analyse l’échantillon demandé, sans refaire les rapports en cache', async () => {
    const deps = base();
    deps.cachedReport.mockImplementation(async (id) => (id === candidateOrder(feed.entries)[0].videoId ? report(id, 90, 90) : null));
    const out = await analyzeChannel(ID, 4, deps);
    expect(out.videos).toHaveLength(4);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
    expect(out.summary.verdict).toBe('fiable');
  });
  it('remplace une vidéo écartée par la suivante et le note dans les écartées', async () => {
    const deps = base();
    deps.analyze.mockImplementationOnce(async () => ({ skip: 'vidéo trop courte' }));
    const out = await analyzeChannel(ID, 3, deps);
    expect(out.videos).toHaveLength(3);
    expect(out.skipped).toEqual([expect.objectContaining({ reason: 'vidéo trop courte' })]);
  });
  it('s’arrête proprement quand l’IA n’est plus disponible et garde ce qui est fait', async () => {
    const deps = base();
    deps.analyze.mockResolvedValueOnce(report('a', 80, 80)).mockResolvedValueOnce(report('b', 70, 70)).mockRejectedValue(new Error('Quota gratuit du jour atteint'));
    const out = await analyzeChannel(ID, 6, deps);
    expect(out.videos).toHaveLength(2);
    expect(out.warnings[0]).toMatch(/interrompue après 2 vidéo/);
    expect(out.summary.verdict).toBe('insuffisant');
  });
  it('une erreur isolée écarte la vidéo mais continue', async () => {
    const deps = base();
    deps.analyze.mockRejectedValueOnce(new Error('transcription illisible'));
    const out = await analyzeChannel(ID, 3, deps);
    expect(out.videos).toHaveLength(3);
    expect(out.skipped[0].reason).toContain('transcription illisible');
  });
  it('respecte l’annulation', async () => {
    const deps = base();
    let n = 0;
    const out = await analyzeChannel(ID, 6, { ...deps, isCancelled: () => n++ >= 2 });
    expect(out.videos.length).toBeLessThanOrEqual(2);
    expect(out.warnings.join(' ')).toMatch(/arrêtée à ta demande/);
  });
  it('signale une chaîne sans vidéo', async () => {
    await expect(analyzeChannel(ID, 3, { ...base(), fetchFeed: async () => ({ ...feed, entries: [] }) })).rejects.toThrow(/aucune vidéo/);
  });
});

describe('channelToMarkdown', () => {
  it('écrit le verdict, les procédés et les vidéos', async () => {
    const deps = {
      fetchFeed: async (): Promise<Feed> => ({ channelId: ID, name: 'Chaîne', entries: [entry(0), entry(1), entry(2)] }),
      cachedReport: async (): Promise<Report | null> => null,
      analyze: async (e: FeedEntry): Promise<Report | { skip: string }> => report(e.videoId, 80, 80),
      now: () => '2026-10-13T00:00:00Z',
    };
    const md = channelToMarkdown(await analyzeChannel(ID, 3, deps));
    expect(md).toContain('type: "chaine"');
    expect(md).toContain('# Chaîne');
    expect(md).toContain('Urgence artificielle (3/3 vidéos)');
    expect(md).toContain('https://www.youtube.com/watch?v=V0000000000');
  });
});
