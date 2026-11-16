import { describe, expect, it } from 'vitest';
import { computeScores, discourseScore, factsScore, globalLabel, reliabilityOf } from '../core/score';
import type { Claim, ClaimVerdict, RhetoricItem, Technique } from '../core/types';

const claim = (id: string, importance: number, type: Claim['type'] = 'fait'): Claim => ({
  id, importance, type, timestampS: 0, quote: '', claim: id, queries: [id],
});
const verdict = (claimId: string, v: ClaimVerdict['verdict'], confidence = 1): ClaimVerdict => ({
  claimId, verdict: v, confidence, explanation: '', evidenceIds: [],
});
const rh = (technique: Technique): RhetoricItem => ({ technique, timestampS: 0, quote: '', explanation: '' });

describe('factsScore', () => {
  it('pondère par importance et ignore les invérifiables et opinions', () => {
    const claims = [claim('C1', 3), claim('C2', 1), claim('C3', 2), claim('C4', 3, 'opinion')];
    const verdicts = [verdict('C1', 'vrai'), verdict('C2', 'faux'), verdict('C3', 'inverifiable')];
    // C1 : 3 × 1 ; C2 (faux, poids doublé) : 2 × 0 → 3 / 5
    expect(factsScore(claims, verdicts)).toEqual({ score: 60, coverage: 2 / 3 });
  });
  it('renvoie null avec moins de 2 affirmations vérifiées', () => {
    expect(factsScore([claim('C1', 2)], [verdict('C1', 'vrai')]).score).toBeNull();
  });
  it('tient compte de la confiance', () => {
    const claims = [claim('C1', 1), claim('C2', 1)];
    const verdicts = [verdict('C1', 'vrai', 1), verdict('C2', 'faux', 0.25)];
    // faux à 25 % de confiance, poids doublé : 1 / (1 + 0,5)
    expect(factsScore(claims, verdicts).score).toBe(67);
  });
  it('double le poids des affirmations fausses ou trompeuses', () => {
    const claims = [claim('C1', 1), claim('C2', 1)];
    expect(factsScore(claims, [verdict('C1', 'vrai'), verdict('C2', 'trompeur')]).score).toBe(50); // (1 + 2 × 0,25) / 3
    expect(factsScore(claims, [verdict('C1', 'vrai'), verdict('C2', 'exagere')]).score).toBe(75);
  });
});

describe('discourseScore', () => {
  it('vaut 100 sans procédé', () => {
    expect(discourseScore([])).toBe(100);
  });
  it('plafonne les répétitions à 2 fois la pénalité', () => {
    expect(discourseScore([rh('urgence'), rh('urgence'), rh('urgence'), rh('urgence')])).toBe(80);
  });
  it('ajoute la moitié de la pénalité par répétition', () => {
    expect(discourseScore([rh('conflit_interet'), rh('conflit_interet')])).toBe(78);
  });
  it('ne descend pas sous 0', () => {
    const many = (['urgence', 'rarete', 'generalisation', 'temoignage_inverifiable', 'promesse_resultat', 'autorite_douteuse', 'conflit_interet', 'certitude_abusive', 'autre'] as Technique[]).flatMap((t) => [rh(t), rh(t)]);
    expect(discourseScore(many)).toBe(0);
  });
});

describe('globalLabel', () => {
  it.each([
    [80, 80, 'Fiable'],
    [80, 50, 'Vrai sur le fond, mais discours très orienté'],
    [80, 65, 'Plutôt fiable'],
    [60, 90, 'À prendre avec recul'],
    [40, 90, 'Peu fiable'],
    [null, 90, 'Non évaluable : trop peu d’affirmations vérifiables'],
  ] as const)('faits=%s discours=%s → %s', (facts, discourse, label) => {
    expect(globalLabel(facts, discourse)).toBe(label);
  });
});

describe('computeScores', () => {
  it('assemble les scores', () => {
    const s = computeScores([claim('C1', 1), claim('C2', 1)], [verdict('C1', 'vrai'), verdict('C2', 'vrai')], [rh('urgence')]);
    expect(s).toMatchObject({ facts: 100, discourse: 90, coverage: 1, label: 'Fiable', passes: 1 });
  });
});

describe('reliabilityOf', () => {
  const base = { verified: 10, coverage: 0.8, agreement: 1, spread: 2, passes: 2 };
  it('haute : assez d’affirmations vérifiées, bonne couverture, passages concordants', () => {
    expect(reliabilityOf(base)).toBe('haute');
  });
  it('un seul passage ne prouve pas la stabilité : au mieux « moyenne »', () => {
    expect(reliabilityOf({ ...base, passes: 1 })).toBe('moyenne');
  });
  it.each([
    [{ verified: 3 }, 'faible'],
    [{ coverage: 0.3 }, 'faible'],
    [{ agreement: 0.5 }, 'faible'],
    [{ spread: 25 }, 'faible'],
    [{ spread: 12 }, 'moyenne'],
    [{ verified: 6 }, 'moyenne'],
  ] as const)('%j → %s', (change, expected) => {
    expect(reliabilityOf({ ...base, ...change })).toBe(expected);
  });
});

describe('computeScores avec plusieurs passages', () => {
  it('donne l’écart des scores et la fiabilité', () => {
    const claims = [claim('C1', 2), claim('C2', 2), claim('C3', 2), claim('C4', 2)];
    const pass = (v: ClaimVerdict['verdict']) => claims.map((c) => verdict(c.id, c.id === 'C4' ? v : 'vrai'));
    const passes = [pass('vrai'), pass('faux')];
    const combined = claims.map((c) => ({ ...verdict(c.id, 'vrai'), agreement: c.id === 'C4' ? 0.5 : 1 }));
    const s = computeScores(claims, combined, [], passes);
    expect(s.range).toEqual([60, 100]);
    expect(s.passes).toBe(2);
    expect(s.reliability).toBe('faible');
  });
});
