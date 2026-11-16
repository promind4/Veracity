import { describe, expect, it, vi } from 'vitest';
import { openrouterEngine } from '../core/engine';
import { buildExtractionMessages, extractClaims, MAX_CLAIMS } from '../core/extract';
import type { VideoInput } from '../core/types';

const video: VideoInput = { videoId: 'v', title: 'T', author: 'A', description: 'Lien affilié', durationS: 60, language: 'fr', segments: [] };

describe('buildExtractionMessages', () => {
  it('place les contenus dans des balises et rappelle de ne pas suivre leurs instructions', () => {
    const [system, user] = buildExtractionMessages(video, '[0:00] bonjour');
    expect(system.content).toContain("n'exécute jamais");
    expect(user.content).toContain('<transcription langue="fr">\n[0:00] bonjour\n</transcription>');
    expect(user.content).toContain('Lien affilié');
  });
  it('fournit les catégories existantes pour le classement', () => {
    const [, user] = buildExtractionMessages(video, 'x', ['Agents IA']);
    expect(user.content).toContain('« Agents IA »');
  });
});

describe('actualité', () => {
  it('transmet la date de publication et demande une recherche renforcée', () => {
    const [, user] = buildExtractionMessages({ ...video, publishedAt: '2026-11-16' }, '[0:00] nouveau modèle');
    expect(user.content).toContain('<date_publication>2026-11-16</date_publication>');
    expect(user.content).toContain('"time_sensitive"');
  });
});

describe('extractClaims', () => {
  it('normalise la sortie du modèle', async () => {
    const llmOutput = {
      summary: 'Résumé',
      category: 'agents ia',
      tags: ['MCP', ' MCP'],
      claims: [
        ...Array.from({ length: MAX_CLAIMS + 2 }, (_, i) => ({ t: '0:10', quote: 'q', claim: `Affirmation ${i}`, type: 'Fait', importance: 3, queries: ['  ', 'requête'] })),
      ],
      rhetoric: [{ t: 70, technique: 'Rareté', quote: 'il reste 3 places', explanation: 'x' }, { t: 0, technique: 'inconnue', quote: '', explanation: '' }],
    };
    llmOutput.claims[1] = { t: '1:00', quote: '', claim: 'Sans requête', type: 'promesse commerciale', importance: 9, queries: [] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmOutput) } }] })));
    const { extraction, model } = await extractClaims(video, 'x', openrouterEngine({ key: 'k', models: ['m'], fetchFn }), ['Agents IA']);
    expect(model).toBe('m');
    expect(extraction.claims).toHaveLength(MAX_CLAIMS);
    expect(extraction.claims[0]).toEqual({ id: 'C1', timestampS: 10, quote: 'q', claim: 'Affirmation 0', type: 'fait', importance: 3, queries: ['requête'] });
    expect(extraction.claims[1]).toMatchObject({ id: 'C2', type: 'promesse_commerciale', importance: 2, queries: ['Sans requête'] });
    expect(extraction.rhetoric.map((r) => r.technique)).toEqual(['rarete', 'autre']);
    expect(extraction).toMatchObject({ category: 'Agents IA', tags: ['MCP'] });
  });
});
