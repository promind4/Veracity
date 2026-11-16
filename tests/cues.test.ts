import { describe, expect, it } from 'vitest';
import { buildCues, cueAt } from '../core/cues';

describe('buildCues', () => {
  it('coupe en fin de phrase et termine au segment suivant', () => {
    const cues = buildCues([
      { start: 0, text: 'Hello everyone.' },
      { start: 1.5, text: 'Today we talk' },
      { start: 3, text: 'about agents.' },
      { start: 5, text: 'Let us go' },
    ]);
    expect(cues).toEqual([
      { start: 0, end: 1.5, text: 'Hello everyone.' },
      { start: 1.5, end: 5, text: 'Today we talk about agents.' },
      { start: 5, end: 9, text: 'Let us go' },
    ]);
  });
  it('limite la durée et la longueur sans ponctuation (sous-titres automatiques)', () => {
    const segs = Array.from({ length: 6 }, (_, i) => ({ start: i * 2, text: `mot${i}` }));
    expect(buildCues(segs, 5).map((c) => [c.start, c.end, c.text])).toEqual([
      [0, 6, 'mot0 mot1 mot2'],
      [6, 14, 'mot3 mot4 mot5'],
    ]);
    expect(buildCues([{ start: 0, text: 'a'.repeat(30) }, { start: 1, text: 'b'.repeat(30) }], 7, 40).map((c) => c.text)).toEqual(['a'.repeat(30), 'b'.repeat(30)]);
  });
  it("n'étire pas un sous-titre pendant un long silence", () => {
    expect(buildCues([{ start: 0, text: 'Bonjour.' }, { start: 30, text: 'Suite.' }])[0]).toEqual({ start: 0, end: 6, text: 'Bonjour.' });
  });
});

describe('cueAt', () => {
  const cues = [
    { start: 0, end: 2, text: 'a' },
    { start: 2, end: 4, text: 'b' },
    { start: 10, end: 12, text: 'c' },
  ];
  it('trouve le sous-titre affiché à un instant donné', () => {
    expect(cueAt(cues, 0)?.text).toBe('a');
    expect(cueAt(cues, 3.9)?.text).toBe('b');
    expect(cueAt(cues, 11)?.text).toBe('c');
  });
  it('ne renvoie rien entre deux sous-titres', () => {
    expect(cueAt(cues, 6)).toBeUndefined();
    expect(cueAt(cues, -1)).toBeUndefined();
  });
});

describe('buildCues : marqueurs de changement d’intervenant', () => {
  it('coupe à chaque « >> » et retire le marqueur du texte', () => {
    expect(buildCues([{ start: 0, text: '>> Come in,' }, { start: 1, text: 'please' }, { start: 2, text: '>> Hi, Hannah' }]).map((c) => c.text)).toEqual([
      'Come in, please',
      'Hi, Hannah',
    ]);
  });
});
