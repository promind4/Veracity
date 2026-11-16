import { describe, expect, it } from 'vitest';
import { buildHistory, filterHistory, historyCategories } from '../core/history';
import { buildKbIndex, parseFrontMatter } from '../core/kbIndex';

const storage: Record<string, unknown> = {
  config: { openrouterKey: 'x' },
  'video:aaa': { videoId: 'aaa', title: 'Agents IA expliqués', author: 'Jeff', durationS: 600, language: 'en', segments: [{ start: 0, text: 'x' }] },
  'report:aaa': { videoId: 'aaa', title: 'Agents IA expliqués', author: 'Jeff', createdAt: '2026-10-10T10:00:00Z', scores: { label: 'Fiable', facts: 90, discourse: 80, coverage: 1 } },
  'chat:aaa': [
    { role: 'user', content: 'Q1', at: '2026-10-11T09:00:00Z' },
    { role: 'assistant', content: 'R1', at: '2026-10-11T09:01:00Z' },
    { role: 'user', content: 'Q2', at: '2026-10-11T09:05:00Z' },
  ],
  'translation:aaa:fr': { lang: 'fr', cues: [], createdAt: '2026-10-10T11:00:00Z' },
  'meta:aaa': { category: 'Agents IA', tags: ['MCP'] },
  'video:bbb': { videoId: 'bbb', title: 'Dropshipping débutant', author: 'Cédric', durationS: 800, language: 'fr', transcriptSource: 'gemini', segments: [] },
  'visit:bbb': '2026-10-12T08:00:00Z',
  'report:ccc': { videoId: 'ccc', title: 'Sans transcription en cache', author: 'X', createdAt: '2026-10-01T00:00:00Z', scores: { label: 'Peu fiable', facts: 30, discourse: 20, coverage: 1 } },
  'speakers:aaa': { speakers: [{ id: 'S1' }, { id: 'S2' }], byCue: [] },
};

describe('buildHistory', () => {
  const history = buildHistory(storage);
  it('agrège les données de chaque vidéo et trie par activité récente', () => {
    expect(history.map((h) => h.videoId)).toEqual(['bbb', 'aaa', 'ccc']);
    expect(history[1]).toEqual({
      videoId: 'aaa',
      title: 'Agents IA expliqués',
      author: 'Jeff',
      durationS: 600,
      language: 'en',
      transcriptSource: undefined,
      lastActivity: '2026-10-11T09:05:00Z',
      report: { label: 'Fiable', facts: 90, discourse: 80, createdAt: '2026-10-10T10:00:00Z' },
      questions: 2,
      translations: ['fr'],
      category: 'Agents IA',
      tags: ['MCP'],
      speakers: 2,
    });
  });
  it('garde une vidéo connue seulement par son rapport', () => {
    expect(history[2]).toMatchObject({ videoId: 'ccc', title: 'Sans transcription en cache', report: { label: 'Peu fiable' }, questions: 0 });
  });
});

describe('filterHistory', () => {
  const history = buildHistory(storage);
  it('cherche sans tenir compte des accents dans le titre, la chaîne, la catégorie et les tags', () => {
    expect(filterHistory(history, { query: 'debutant' }).map((h) => h.videoId)).toEqual(['bbb']);
    expect(filterHistory(history, { query: 'mcp' }).map((h) => h.videoId)).toEqual(['aaa']);
  });
  it('filtre par catégorie et par type', () => {
    expect(filterHistory(history, { category: 'Agents IA' }).map((h) => h.videoId)).toEqual(['aaa']);
    expect(filterHistory(history, { only: 'analyzed' }).map((h) => h.videoId)).toEqual(['aaa', 'ccc']);
    expect(filterHistory(history, { only: 'chat' }).map((h) => h.videoId)).toEqual(['aaa']);
    expect(filterHistory(history, { only: 'translated' }).map((h) => h.videoId)).toEqual(['aaa']);
  });
  it('liste les catégories', () => {
    expect(historyCategories(history)).toEqual(['Agents IA']);
  });
});

describe('parseFrontMatter', () => {
  it('lit les métadonnées YAML écrites par Veracity', () => {
    expect(parseFrontMatter('---\ntitre: "Ma \\"vidéo\\""\ntags: ["a", "b"]\nscore_faits: 80\nbrut: texte\n---\n\n# Corps')).toEqual({
      titre: 'Ma "vidéo"',
      tags: ['a', 'b'],
      score_faits: 80,
      brut: 'texte',
    });
    expect(parseFrontMatter('# Pas de métadonnées')).toEqual({});
  });
});

describe('buildKbIndex', () => {
  it('produit une table des matières par catégorie avec liens vers les fichiers', () => {
    const md = buildKbIndex(
      [
        {
          category: 'Agents IA',
          folder: 'Agents IA expliqués [aaa]',
          files: ['transcription.md', 'rapport.md', 'discussion.md'],
          meta: { titre: 'Agents IA expliqués', chaine: 'Jeff', url: 'https://www.youtube.com/watch?v=aaa', enregistre_le: '2026-10-11', verdict: 'Fiable', score_faits: 90, score_discours: 80, tags: ['MCP'] },
        },
        { category: 'Dropshipping', folder: 'Débutant [bbb]', files: ['transcription.md'], meta: { titre: 'Débutant', chaine: 'Cédric', enregistre_le: '2026-10-12' } },
      ],
      '2026-10-12',
    );
    expect(md).toContain('# Base de connaissances YouTube\n\n_2 vidéos · 2 catégories · mis à jour le 2026-10-12_');
    expect(md).toContain('## Agents IA (1)');
    expect(md).toContain('- **[Agents IA expliqués](<Agents IA/Agents IA expliqués [aaa]/rapport.md>)** — Jeff · 2026-10-11 · Fiable (faits 90 %, discours 80 %)');
    expect(md).toContain('  - Fichiers : [rapport](<Agents IA/Agents IA expliqués [aaa]/rapport.md>) · [discussion](<Agents IA/Agents IA expliqués [aaa]/discussion.md>) · [transcription](<Agents IA/Agents IA expliqués [aaa]/transcription.md>)');
    expect(md).toContain('  - Mots-clés : MCP');
    expect(md).toContain('- **[Débutant](<Dropshipping/Débutant [bbb]/transcription.md>)** — Cédric · 2026-10-12');
  });
});
