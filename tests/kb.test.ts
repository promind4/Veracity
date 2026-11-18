import { describe, expect, it, vi } from 'vitest';
import { categorizeVideo } from '../core/categorize';
import { openrouterEngine } from '../core/engine';
import { frontMatter, kbDocument } from '../core/export';
import { normalizeCategory, sanitizeName, videoFolderName } from '../core/kb';
import type { Report, VideoInput } from '../core/types';

describe('sanitizeName', () => {
  it('retire les caractères interdits par Windows et les points finaux', () => {
    expect(sanitizeName('Dropshipping : tu as "signé" pour en baver ?...')).toBe('Dropshipping tu as signé pour en baver');
  });
  it('tronque', () => {
    expect(sanitizeName('a'.repeat(100), 10)).toBe('aaaaaaaaaa');
  });
});

describe('normalizeCategory', () => {
  it('rapproche les synonymes explicites sans confondre les spécialités', () => {
    expect(normalizeCategory('IA', ['Intelligence artificielle'])).toBe('Intelligence artificielle');
    expect(normalizeCategory('Machine learning', ['Apprentissage automatique'])).toBe('Apprentissage automatique');
    expect(normalizeCategory('Infographie 3D', ['Informatique'])).toBe('Infographie 3D');
  });
  const existing = ['Agents IA', 'E-commerce & Dropshipping'];
  it('réutilise une catégorie existante malgré casse et accents', () => {
    expect(normalizeCategory('agents ia', existing)).toBe('Agents IA');
    expect(normalizeCategory('E-Commerce & dropshipping', existing)).toBe('E-commerce & Dropshipping');
  });
  it('confond « & » et « et »', () => {
    expect(normalizeCategory('E-commerce et dropshipping', existing)).toBe('E-commerce & Dropshipping');
    expect(normalizeCategory('Internet', ['Internet'])).toBe('Internet');
  });
  it('crée une nouvelle catégorie propre', () => {
    expect(normalizeCategory('  finance   personnelle ', existing)).toBe('Finance personnelle');
    expect(normalizeCategory('IA/ML', existing)).toBe('IA ML');
  });
  it('a une catégorie de repli', () => {
    expect(normalizeCategory(' ?? ', existing)).toBe('Non classé');
  });
});

describe('videoFolderName', () => {
  it('combine titre nettoyé et identifiant', () => {
    expect(videoFolderName('Dropshipping débutant : tu as signé', 'Vxw4AVCntZY')).toBe('Dropshipping débutant tu as signé [Vxw4AVCntZY]');
  });
});

const video: VideoInput = { videoId: 'abc', title: 'Ma "vidéo"', author: 'Auteur', description: 'Desc', durationS: 125, language: 'fr', segments: [{ start: 0, text: 'Bonjour' }] };

describe('frontMatter', () => {
  it('produit un en-tête YAML et ignore les valeurs vides', () => {
    expect(frontMatter({ titre: 'Ma "vidéo"', tags: ['a', 'b'], score: 42, vide: '', absent: undefined, nul: null })).toBe(
      '---\ntitre: "Ma \\"vidéo\\""\ntags: ["a", "b"]\nscore: 42\n---\n\n',
    );
  });
});

describe('kbDocument', () => {
  it('ajoute les métadonnées de la vidéo et du rapport', () => {
    const report = { scores: { label: 'Fiable', facts: 80, discourse: 90, coverage: 1 } } as Report;
    const doc = kbDocument('report', video, { category: 'Agents IA', tags: ['MCP'] }, '# Corps\n', report, '2026-10-12');
    expect(doc).toBe(
      '---\ntype: "rapport"\ntitre: "Ma \\"vidéo\\""\nchaine: "Auteur"\nurl: "https://www.youtube.com/watch?v=abc"\nvideo_id: "abc"\nduree: "2:05"\ncategorie: "Agents IA"\ntags: ["MCP"]\nenregistre_le: "2026-10-12"\nverdict: "Fiable"\nscore_faits: 80\nscore_discours: 90\n---\n\n# Corps\n',
    );
  });
});

describe('categorizeVideo', () => {
  it('normalise la catégorie proposée et nettoie les tags', async () => {
    const content = JSON.stringify({ category: 'agents IA', tags: [' MCP ', 'MCP', 'Claude', '', 'a', 'b', 'c'] });
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    const out = await categorizeVideo(video, ['Agents IA'], openrouterEngine({ key: 'k', models: ['m'], fetchFn }));
    expect(out).toEqual({ category: 'Agents IA', tags: ['MCP', 'Claude', 'a', 'b', 'c'], model: 'm' });
    const prompt = JSON.parse(fetchFn.mock.calls[0][1].body).messages[1].content;
    expect(prompt).toContain('« Agents IA »');
    expect(prompt).toContain('[0:00] Bonjour');
  });
});
