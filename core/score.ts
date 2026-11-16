import type { Claim, ClaimVerdict, Reliability, RhetoricItem, Scores, Technique, Verdict } from './types';

export const VERDICT_VALUE: Record<Exclude<Verdict, 'inverifiable'>, number> = {
  vrai: 1,
  plutot_vrai: 0.8,
  exagere: 0.5,
  trompeur: 0.25,
  faux: 0,
};

export const PENALTY: Record<Technique, number> = {
  urgence: 10,
  rarete: 10,
  generalisation: 8,
  temoignage_inverifiable: 8,
  promesse_resultat: 15,
  autorite_douteuse: 8,
  conflit_interet: 15,
  certitude_abusive: 10,
  autre: 5,
};

/** Une affirmation fausse ou trompeuse pèse double : une erreur discrédite plus qu'une vérité ne crédite. */
export const FALSE_WEIGHT = 2;

export function factsScore(claims: Claim[], verdicts: ClaimVerdict[]): { score: number | null; coverage: number } {
  const byId = new Map(verdicts.map((v) => [v.claimId, v]));
  const checkable = claims.filter((c) => c.type !== 'opinion');
  let weighted = 0;
  let totalWeight = 0;
  let verified = 0;
  for (const c of checkable) {
    const v = byId.get(c.id);
    if (!v || v.verdict === 'inverifiable') continue;
    verified++;
    const severity = v.verdict === 'faux' || v.verdict === 'trompeur' ? FALSE_WEIGHT : 1;
    const w = c.importance * severity * Math.min(1, Math.max(0.1, v.confidence));
    weighted += w * VERDICT_VALUE[v.verdict];
    totalWeight += w;
  }
  const coverage = checkable.length ? verified / checkable.length : 0;
  return { score: verified < 2 ? null : Math.round((100 * weighted) / totalWeight), coverage };
}

/** Chaque technique coûte sa pénalité une fois ; chaque répétition +50 %, plafonné à 2×. */
export function discourseScore(rhetoric: RhetoricItem[]): number {
  const counts = new Map<Technique, number>();
  for (const r of rhetoric) counts.set(r.technique, (counts.get(r.technique) ?? 0) + 1);
  let total = 0;
  for (const [technique, n] of counts) {
    const p = PENALTY[technique];
    total += Math.min(2 * p, p + ((n - 1) * p) / 2);
  }
  return Math.round(Math.max(0, Math.min(100, 100 - total)));
}

export function globalLabel(facts: number | null, discourse: number): string {
  if (facts === null) return 'Non évaluable : trop peu d’affirmations vérifiables';
  if (facts >= 75 && discourse >= 75) return 'Fiable';
  if (facts >= 75 && discourse < 60) return 'Vrai sur le fond, mais discours très orienté';
  if (facts >= 75) return 'Plutôt fiable';
  if (facts >= 50) return 'À prendre avec recul';
  return 'Peu fiable';
}

export interface ReliabilityInput {
  /** Affirmations qui ont reçu un verdict (hors « invérifiable »). */
  verified: number;
  coverage: number;
  /** Accord moyen entre passages de vérification (1 = unanimité). */
  agreement: number;
  /** Écart entre le plus petit et le plus grand score des faits selon les passages. */
  spread: number;
  passes: number;
}

/**
 * Confiance dans la note elle-même : peu d'affirmations vérifiées, une faible couverture ou des passages qui divergent
 * rendent le score fragile. « Haute » exige au moins deux passages concordants : un seul passage ne prouve pas la stabilité.
 */
export function reliabilityOf(i: ReliabilityInput): Reliability {
  if (i.verified < 4 || i.coverage < 0.4 || i.agreement < 0.6 || i.spread > 20) return 'faible';
  if (i.passes >= 2 && i.verified >= 8 && i.coverage >= 0.65 && i.agreement >= 0.85 && i.spread <= 8) return 'haute';
  return 'moyenne';
}

export function computeScores(claims: Claim[], verdicts: ClaimVerdict[], rhetoric: RhetoricItem[], passes: ClaimVerdict[][] = []): Scores {
  const { score, coverage } = factsScore(claims, verdicts);
  const discourse = discourseScore(rhetoric);
  const perPass = passes.map((p) => factsScore(claims, p).score).filter((n): n is number => n !== null);
  const range: [number, number] | undefined = perPass.length > 1 ? [Math.min(...perPass), Math.max(...perPass)] : undefined;
  const verifiedVerdicts = verdicts.filter((v) => v.verdict !== 'inverifiable');
  const agreement = verifiedVerdicts.length ? verifiedVerdicts.reduce((sum, v) => sum + (v.agreement ?? 1), 0) / verifiedVerdicts.length : 1;
  const reliability = reliabilityOf({
    verified: verifiedVerdicts.length,
    coverage,
    agreement,
    spread: range ? range[1] - range[0] : 0,
    passes: Math.max(1, passes.length),
  });
  return { facts: score, discourse, coverage, label: globalLabel(score, discourse), ...(range ? { range } : {}), reliability, passes: Math.max(1, passes.length) };
}
