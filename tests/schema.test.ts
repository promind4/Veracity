import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { enumOf, extractJson, normalizeToken, parseTimestamp } from '../core/schema';
import { VERDICTS } from '../core/types';

describe('normalizeToken', () => {
  it('retire accents, casse et espaces', () => {
    expect(normalizeToken('Exagéré')).toBe('exagere');
    expect(normalizeToken('Plutôt vrai')).toBe('plutot_vrai');
  });
});

describe('enumOf', () => {
  it('accepte les variantes accentuées', () => {
    expect(enumOf(VERDICTS).parse('Invérifiable')).toBe('inverifiable');
  });
  it('utilise la valeur de repli pour une valeur inconnue', () => {
    expect(enumOf(VERDICTS, 'inverifiable').parse('bof')).toBe('inverifiable');
  });
  it('rejette une valeur inconnue sans repli', () => {
    expect(() => enumOf(VERDICTS).parse('bof')).toThrow(z.ZodError);
  });
});

describe('parseTimestamp', () => {
  it('lit secondes, mm:ss et h:mm:ss', () => {
    expect(parseTimestamp(75)).toBe(75);
    expect(parseTimestamp('75')).toBe(75);
    expect(parseTimestamp('01:15')).toBe(75);
    expect(parseTimestamp('[1:00:05]')).toBe(3605);
    expect(parseTimestamp('n/a')).toBe(0);
  });
});

describe('extractJson', () => {
  it('lit un JSON entouré de texte ou de balises markdown', () => {
    expect(extractJson('Voici :\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blabla {"a":{"b":2}} fin')).toEqual({ a: { b: 2 } });
  });
  it('échoue sans objet JSON', () => {
    expect(() => extractJson('rien')).toThrow('Aucun objet JSON');
  });
});
