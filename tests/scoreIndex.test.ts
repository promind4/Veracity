import { describe, expect, it } from 'vitest';
import { buildScoreIndex, chipOf, entryOf, toneOf } from '../core/scoreIndex';

const report = (videoId: string, facts: number | null, discourse = 80) => ({ videoId, author: 'Chaîne', createdAt: '2026-10-13', scores: { facts, discourse, label: 'Fiable' } });

describe('buildScoreIndex', () => {
  it('ne garde que les rapports, par identifiant de vidéo', () => {
    const index = buildScoreIndex({ 'report:a': report('a', 90), 'report:b': report('b', null), 'chat:a': [], 'report:cassé': { videoId: 'x' }, lexicon: {} });
    expect(Object.keys(index).sort()).toEqual(['a', 'b']);
    expect(index.a).toMatchObject({ facts: 90, discourse: 80, label: 'Fiable', author: 'Chaîne', at: '2026-10-13' });
  });
});

describe('chipOf', () => {
  it('affiche le score des faits, coloré, et le détail en infobulle', () => {
    expect(chipOf(entryOf(report('a', 92)))).toMatchObject({ text: 'Faits 92 %', tone: 'ok' });
    expect(chipOf(entryOf(report('a', 60))).tone).toBe('warn');
    expect(chipOf(entryOf(report('a', 16))).tone).toBe('bad');
    const na = chipOf(entryOf(report('a', null)));
    expect(na).toMatchObject({ text: 'Non évaluable', tone: 'na' });
    expect(chipOf(entryOf(report('a', 92, 55))).title).toContain('discours 55 %');
  });
  it('seuils : 75 et 50', () => {
    expect([toneOf(75), toneOf(74), toneOf(50), toneOf(49)]).toEqual(['ok', 'warn', 'warn', 'bad']);
  });
});
