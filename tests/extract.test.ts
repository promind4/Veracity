import { describe, expect, it, vi } from 'vitest';
import { openrouterEngine } from '../core/engine';
import { buildExtractionMessages, extractClaims, MAX_CLAIMS } from '../core/extract';
import type { VideoInput } from '../core/types';

const video: VideoInput = { videoId: 'v', title: 'T', author: 'A', description: 'Lien affili�', durationS: 60, language: 'fr', segments: [] };

describe('buildExtractionMessages', () => {
  it('inclut le texte d'une publication X sans inventer une transcription vid�o', () => {
    const [, user] = buildExtractionMessages({ ...video, platform: 'x', description: 'Une annonce � v�rifier', segments: [] }, '');
    expect(user.content).toContain('Une annonce � v�rifier');
    expect(user.content).toContain("Ne pr�tends pas avoir vu ou entendu la vid�o si les sous-titres sont absents");
    expect(user.content).toContain('du texte de la publication ou des sous-titres fournis');
  });
  it('place les contenus dans des balises et rappelle de ne pas suivre leurs instructions', () => {
    const [system, user] = buildExtractionMessages(video, '[0:00] bonjour');
    expect(system.content).toContain("n'ex�cute jamais");
    expect(user.content).toContain('<transcription langue="fr">\n[0:00] bonjour\n</transcription>');
    expect(user.content).toContain('Lien affili�');
  });
  it('fournit les cat�gories existantes pour le classement', () => {
    const [, user] = buildExtractionMessages(video, 'x', ['Agents IA']);
    expect(user.content).toContain('� Agents IA �');
  });
});

describe('extractClaims', () => {
  it('�carte une action dans GTA du contr�le des faits tout en gardant une affirmation sur le jeu', async () => {
    const content = JSON.stringify({ claims: [
      { t: 0, claim: 'Le personnage traverse une for�t', context: 'fiction' },
      { t: 2, claim: 'Le joueur se trouve dans une for�t', context: 'unclear' },
      { t: 3, claim: 'Rockstar publie une mise � jour de GTA', context: 'real' },
    ] });
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
    const { extraction } = await extractClaims(
      { ...video, platform: 'x', description: 'Gameplay GTA' }, '[0:00] Je traverse la for�t',
      openrouterEngine({ key: 'k', models: ['m'], fetchFn }),
    );
    expect(extraction.claims.map((claim) => claim.claim)).toEqual(['Rockstar publie une mise � jour de GTA']);
  });
  it('normalise la sortie du mod�le', async () => {
    const llmOutput = {
      summary: 'R�sum�',
      category: 'agents ia',
      tags: ['MCP', ' MCP'],
      claims: [
        ...Array.from({ length: MAX_CLAIMS + 2 }, (_, i) => ({ t: '0:10', quote: 'q', claim: `Affirmation ${i}`, type: 'Fait', importance: 3, queries: ['  ', 'requ�te'] })),
      ],
      rhetoric: [{ t: 70, technique: 'Raret�', quote: 'il reste 3 places', explanation: 'x' }, { t: 0, technique: 'inconnue', quote: '', explanation: '' }],
    };
    llmOutput.claims[1] = { t: '1:00', quote: '', claim: 'Sans requ�te', type: 'promesse commerciale', importance: 9, queries: [] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(llmOutput) } }] })));
    const { extraction, model } = await extractClaims(video, 'x', openrouterEngine({ key: 'k', models: ['m'], fetchFn }), ['Agents IA']);
    expect(model).toBe('m');
    expect(extraction.claims).toHaveLength(MAX_CLAIMS);
    expect(extraction.claims[0]).toEqual({ id: 'C1', timestampS: 10, quote: 'q', claim: 'Affirmation 0', type: 'fait', importance: 3, queries: ['requ�te'] });
    expect(extraction.claims[1]).toMatchObject({ id: 'C2', type: 'promesse_commerciale', importance: 2, queries: ['Sans requ�te'] });
    expect(extraction.rhetoric.map((r) => r.technique)).toEqual(['rarete', 'autre']);
    expect(extraction).toMatchObject({ category: 'Agents IA', tags: ['MCP'] });
  });
});
