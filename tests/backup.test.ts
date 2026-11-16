import { describe, expect, it } from 'vitest';
import { buildVideoBackup, mergeLexicons, parseLexiconBackup, parseVideoBackup, restorePlan, tutorChatToMarkdown, videoKeys } from '../core/backup';
import type { Lexicon, LexiconTerm } from '../core/lexicon';

const ID = 'abc12345678';
const report = (createdAt: string) => ({ videoId: ID, title: 'T', createdAt });
const turn = (n: number) => Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `q${i}`, at: '2026-10-13T10:00:00Z' }));
const term = (id: string, updatedAt: string, extra: Partial<LexiconTerm> = {}): LexiconTerm => ({
  id, term: id.toUpperCase(), full: '', definition: `def ${id}`, example: '', domain: 'D', related: [], status: 'new', videos: [], box: 0, reviews: 0, createdAt: updatedAt, updatedAt, ...extra,
});

describe('buildVideoBackup / videoKeys', () => {
  it('rassemble tout ce que le stockage garde sur la vidéo, traductions comprises', () => {
    const items = { [`report:${ID}`]: report('2026-10-13T10:00:00Z'), [`translation:${ID}:fr`]: { lang: 'fr' }, [`translation:${ID}:es`]: { lang: 'es' }, 'report:autre': {} };
    const b = buildVideoBackup(ID, items, 'now');
    expect(b.report?.title).toBe('T');
    expect(b.translations.map((t) => t.lang)).toEqual(['fr', 'es']);
    expect(videoKeys(ID, ['fr'])).toContain(`translation:${ID}:fr`);
  });
});

describe('parseVideoBackup', () => {
  it('refuse ce qui n’est pas une sauvegarde de vidéo', () => {
    expect(parseVideoBackup(null)).toBeNull();
    expect(parseVideoBackup({ videoId: 'trop-court' })).toBeNull();
    expect(parseVideoBackup({ videoId: ID })?.translations).toEqual([]);
  });
});

describe('restorePlan', () => {
  const backup = parseVideoBackup({
    videoId: ID,
    report: report('2026-10-13T12:00:00Z'),
    chat: turn(4),
    meta: { category: 'Rust', tags: [] },
    translations: [{ lang: 'fr', createdAt: '2026-10-13T12:00:00Z' }],
  })!;
  it('importe tout ce qui manque localement', () => {
    expect(Object.keys(restorePlan(backup, {})).sort()).toEqual([`chat:${ID}`, `meta:${ID}`, `report:${ID}`, `translation:${ID}:fr`].sort());
  });
  it('n’écrase jamais du plus récent ni du plus complet', () => {
    const local = { [`report:${ID}`]: report('2026-10-14T00:00:00Z'), [`chat:${ID}`]: turn(6), [`meta:${ID}`]: { category: 'Autre', tags: [] }, [`translation:${ID}:fr`]: { lang: 'fr', createdAt: '2026-10-14T00:00:00Z' } };
    expect(restorePlan(backup, local)).toEqual({});
  });
  it('remplace un rapport plus ancien et complète une discussion plus courte', () => {
    const plan = restorePlan(backup, { [`report:${ID}`]: report('2026-10-01T00:00:00Z'), [`chat:${ID}`]: turn(2) });
    expect(Object.keys(plan)).toContain(`report:${ID}`);
    expect((plan[`chat:${ID}`] as unknown[]).length).toBe(4);
  });
});

describe('mergeLexicons', () => {
  it('garde la version la plus récente de chaque terme et additionne les vidéos', () => {
    const local: Lexicon = { mqtt: term('mqtt', '2026-10-13T10:00:00Z', { status: 'known', videos: [{ videoId: 'a', title: 'A', why: '', t: 0 }] }) };
    const remote: Lexicon = {
      mqtt: term('mqtt', '2026-10-12T10:00:00Z', { definition: 'ancienne', videos: [{ videoId: 'b', title: 'B', why: '', t: 0 }] }),
      zigbee: term('zigbee', '2026-10-12T10:00:00Z'),
    };
    const merged = mergeLexicons(local, remote);
    expect(Object.keys(merged).sort()).toEqual(['mqtt', 'zigbee']);
    expect(merged.mqtt.status).toBe('known');
    expect(merged.mqtt.definition).toBe('def mqtt');
    expect(merged.mqtt.videos.map((v) => v.videoId)).toEqual(['a', 'b']);
  });
  it('une version distante plus récente l’emporte', () => {
    const merged = mergeLexicons({ x: term('x', '2026-10-01T00:00:00Z') }, { x: term('x', '2026-10-05T00:00:00Z', { definition: 'nouvelle' }) });
    expect(merged.x.definition).toBe('nouvelle');
  });
});

describe('lexique : fichiers', () => {
  it('reconnaît une sauvegarde de lexique', () => {
    expect(parseLexiconBackup({})).toBeNull();
    expect(parseLexiconBackup({ lexicon: { a: term('a', 'x') } })?.chats).toEqual({});
  });
  it('écrit la discussion d’un terme en Markdown, sans les erreurs', () => {
    const md = tutorChatToMarkdown(term('mqtt', 'x'), [
      { role: 'user', content: 'C’est quoi ?', at: '' },
      { role: 'assistant', content: 'Un protocole.', at: '' },
      { role: 'assistant', content: '⚠️ erreur', at: '', error: true },
    ]);
    expect(md).toContain('type: "discussion-lexique"');
    expect(md).toContain('### 🙋 Moi\n\nC’est quoi ?');
    expect(md).toContain('### 🎓 Tuteur\n\nUn protocole.');
    expect(md).not.toContain('erreur');
  });
});
