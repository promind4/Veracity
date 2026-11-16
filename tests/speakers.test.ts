import { describe, expect, it, vi } from 'vitest';
import { planDubGroups } from '../core/dub';
import { assignVoices, detectSpeakers, parseSpeakers } from '../core/speakers';

describe('parseSpeakers', () => {
  it('lit les intervenants et l’attribution de chaque sous-titre, en comblant les trous', () => {
    const text = `INTERVENANTS
S1 | homme | Animateur
S2 | femme | Dr Martin
ATTRIBUTION
[1] S1
[2] S1
[3] S2
[5] S1
bruit`;
    expect(parseSpeakers(text, 5)).toEqual({
      speakers: [
        { id: 'S1', gender: 'homme', label: 'Animateur' },
        { id: 'S2', gender: 'femme', label: 'Dr Martin' },
      ],
      byCue: ['S1', 'S1', 'S2', 'S2', 'S1'],
    });
  });
  it('ajoute un intervenant cité mais non décrit, et normalise le genre', () => {
    expect(parseSpeakers('S1 | Féminin | \n[1] S1\n[2] S3', 2)).toEqual({
      speakers: [
        { id: 'S1', gender: 'femme', label: '' },
        { id: 'S3', gender: 'inconnu', label: '' },
      ],
      byCue: ['S1', 'S3'],
    });
  });
});

describe('assignVoices', () => {
  const speakers = [
    { id: 'S1', gender: 'homme' as const, label: '' },
    { id: 'S2', gender: 'femme' as const, label: '' },
    { id: 'S3', gender: 'homme' as const, label: '' },
  ];
  it('Gemini : voix choisie pour le premier intervenant de son genre, voix distinctes ensuite', () => {
    expect(assignVoices(speakers, 'gemini', 'fr', 'Charon')).toEqual({ S1: 'Charon', S2: 'Kore', S3: 'Puck' });
    expect(assignVoices(speakers, 'gemini', 'fr', 'Kore')).toEqual({ S1: 'Charon', S2: 'Kore', S3: 'Puck' });
    expect(assignVoices(speakers, 'gemini', 'fr', 'Aoede')).toEqual({ S1: 'Charon', S2: 'Aoede', S3: 'Puck' });
  });
  it('Piper : voix françaises par genre', () => {
    expect(assignVoices(speakers, 'piper', 'fr', 'fr_FR-siwis-medium')).toEqual({
      S1: 'fr_FR-tom-medium',
      S2: 'fr_FR-siwis-medium',
      S3: 'fr_FR-gilles-low',
    });
  });
  it('réutilise les voix quand il y a plus d’intervenants que de voix', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ id: `S${i + 1}`, gender: 'homme' as const, label: '' }));
    expect(Object.values(assignVoices(many, 'piper', 'fr', undefined))).toEqual(['fr_FR-tom-medium', 'fr_FR-gilles-low', 'fr_FR-tom-medium', 'fr_FR-gilles-low']);
  });
});

describe('planDubGroups avec intervenants', () => {
  it('ne regroupe jamais deux intervenants dans le même passage', () => {
    const cues = [
      { start: 0, end: 2, text: 'Bonjour.', speaker: 'S1' },
      { start: 2, end: 4, text: 'Salut.', speaker: 'S2' },
      { start: 4, end: 6, text: 'Ça va ?', speaker: 'S2' },
    ];
    expect(planDubGroups(cues, 20).map((g) => [g.text, g.speaker])).toEqual([
      ['Bonjour.', 'S1'],
      ['Salut. Ça va ?', 'S2'],
    ]);
  });
});

describe('detectSpeakers', () => {
  it('envoie la vidéo et les sous-titres numérotés à Gemini', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'S1 | homme | Hôte\n[1] S1\n[2] S1' }] } }] })),
    );
    const out = await detectSpeakers('abc', [{ start: 0, end: 2, text: 'Hello' }, { start: 65, end: 67, text: 'World' }], { key: 'k', fetchFn });
    expect(out.byCue).toEqual(['S1', 'S1']);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].fileData.fileUri).toBe('https://www.youtube.com/watch?v=abc');
    expect(body.contents[0].parts[1].text).toContain('[2] (1:05) World');
  });
});
