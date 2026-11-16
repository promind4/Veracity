import { describe, expect, it, vi } from 'vitest';
import { mergeTerms, termKey } from '../core/lexicon';
import { buildQuizPrompt, generateQuizzes, parseQuizzes, shuffleQuiz } from '../core/quiz';

const NOW = '2026-10-13T10:00:00.000Z';
const terms = Object.values(
  mergeTerms({}, [{ term: 'MQTT', full: '', definition: 'Un protocole de messages.', why: '', example: '', domain: 'Domotique', related: [], t: 0 }], null, NOW).lexicon,
);
const good = { id: termKey('MQTT'), question: 'Quel est le rôle du broker ?', choices: ['Relayer les messages', 'Chiffrer le Wi-Fi', 'Stocker les vidéos', 'Compiler le code'], answer: 0, explanation: 'Il redistribue.' };

describe('shuffleQuiz', () => {
  it('garde la bonne réponse associée au bon indice, quel que soit l’ordre', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const q = shuffleQuiz(good, () => r);
      expect(q.choices[q.answer]).toBe('Relayer les messages');
      expect([...q.choices].sort()).toEqual([...good.choices].sort());
    }
  });
});

describe('parseQuizzes', () => {
  it('ignore les questions invalides, inconnues ou aux propositions en double', () => {
    const out = parseQuizzes(
      [good, { ...good, id: 'inconnu' }, { ...good, choices: ['a', 'b', 'c'] }, { ...good, choices: ['a', 'A', 'b', 'c'] }, 'n’importe quoi'],
      [termKey('MQTT')],
      () => 0.5,
    );
    expect(Object.keys(out)).toEqual([termKey('MQTT')]);
  });
});

describe('buildQuizPrompt', () => {
  it('liste les termes avec leur définition et le profil', () => {
    const prompt = buildQuizPrompt(terms, 'Débutant');
    expect(prompt).toContain('MQTT — Un protocole de messages.');
    expect(prompt).toContain('Débutant');
  });
});

describe('generateQuizzes', () => {
  it('interroge Gemini une seule fois pour tout le lot', async () => {
    const fetchFn = vi.fn(async (_url: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ quizzes: [good] }) }] } }] }), { status: 200 }));
    const out = await generateQuizzes(terms, undefined, { geminiKey: 'k', openrouterKey: '', models: [] }, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(out[termKey('MQTT')].question).toContain('broker');
  });
  it('sans terme, ne fait aucune requête', async () => {
    expect(await generateQuizzes([], undefined, { openrouterKey: '', models: [] })).toEqual({});
  });
});
