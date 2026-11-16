import { z } from 'zod';
import { SYSTEM_PROMPT } from './extract';
import { mapLimit } from './async';
import type { JsonEngine } from './engine';
import type { ChatMessage } from './llm';
import { enumOf } from './schema';
import { VERDICT_VALUE } from './score';
import { type Claim, type ClaimVerdict, type Evidence, VERDICTS, type VideoInput } from './types';

const VerifySchema = z.object({
  verdicts: z
    .array(
      z.object({
        claim_id: z.string(),
        verdict: enumOf(VERDICTS, 'inverifiable'),
        confidence: z.coerce.number().min(0).max(1).catch(0.5),
        explanation: z.string().default(''),
        correction: z.string().nullish(),
        evidence_ids: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export type RawVerdict = z.infer<typeof VerifySchema>['verdicts'][number];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function evidenceLine(e: Evidence): string {
  const head = e.source === 'factcheck' ? `FACT-CHECK ${e.publisher ?? ''}, verdict « ${e.rating ?? '?'} » : ` : '';
  return `- [${e.id}] ${head}${e.title} (${hostOf(e.url)}${e.date ? `, ${e.date}` : ''}) : ${e.snippet.slice(0, 700)}`;
}

export function buildVerifyMessages(video: VideoInput, claims: Claim[], evidence: Evidence[], today: string): ChatMessage[] {
  const blocks = claims.map((c) => {
    const items = evidence.filter((e) => e.claimId === c.id);
    return `### ${c.id} (${c.type}) : « ${c.claim} »
Citation : « ${c.quote} »
Preuves :
${items.length ? items.map(evidenceLine).join('\n') : '(aucune preuve trouvée)'}`;
  });
  const user = `Date du jour : ${today}. Vidéo : « ${video.title} » (${video.author}).

Juge chaque affirmation UNIQUEMENT à partir des preuves fournies.

<affirmations_et_preuves>
${blocks.join('\n\n')}
</affirmations_et_preuves>

Verdicts possibles :
- vrai : confirmé par les preuves.
- plutot_vrai : globalement exact, avec une imprécision mineure.
- exagere : base réelle mais chiffre, portée ou certitude gonflés.
- trompeur : techniquement défendable mais présenté de façon à induire en erreur, ou sorti de son contexte.
- faux : contredit par les preuves.
- inverifiable : aucune preuve pertinente parmi celles fournies.

Règles :
- N'utilise pas tes connaissances personnelles pour trancher : sans preuve pertinente, le verdict est "inverifiable".
- La plausibilité ne suffit pas : une affirmation personnelle (revenus, expérience, anecdote de l'auteur) reste "inverifiable" sans preuve directe la concernant.
- Une source qui émane de l'auteur de la vidéo (son site, ses réseaux) ne prouve pas ses propres affirmations.
- Un fact-check publié (FACT-CHECK) prime sur les autres sources lorsqu'il porte sur la même affirmation.
- Pour une promesse_commerciale, compare-la aux données disponibles (taux de réussite, revenus réels…) ; si rien ne permet de la confirmer ou de la contredire, "inverifiable".
- "evidence_ids" : les identifiants [E…] qui fondent ton verdict, uniquement parmi ceux listés pour cette affirmation.
- "correction" : la version exacte de l'affirmation si le verdict est exagere, trompeur ou faux ; sinon null.
- "confidence" : entre 0 et 1, selon la qualité et la concordance des sources.
- "explanation" : 1 à 3 phrases factuelles.

Réponds UNIQUEMENT avec ce JSON, une entrée par affirmation :
{"verdicts":[{"claim_id":"C1","verdict":"vrai","confidence":0.8,"explanation":"...","correction":null,"evidence_ids":["E1"]}]}`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/** Rend impossible toute source inventée : seules les preuves réellement collectées pour l'affirmation sont gardées. */
export function sanitizeVerdicts(raw: RawVerdict[], claims: Claim[], evidence: Evidence[]): ClaimVerdict[] {
  return claims.map((c) => {
    const r = raw.find((x) => x.claim_id.trim().toUpperCase() === c.id);
    if (!r) {
      return { claimId: c.id, verdict: 'inverifiable', confidence: 0, explanation: "Le modèle n'a pas traité cette affirmation.", evidenceIds: [] };
    }
    const allowed = new Set(evidence.filter((e) => e.claimId === c.id).map((e) => e.id));
    const evidenceIds = [...new Set(r.evidence_ids.map((id) => id.trim().toUpperCase()))].filter((id) => allowed.has(id));
    if (r.verdict !== 'inverifiable' && !evidenceIds.length) {
      return {
        claimId: c.id,
        verdict: 'inverifiable',
        confidence: Math.min(r.confidence, 0.3),
        explanation: `Aucune source fournie à l'appui de ce verdict (« ${r.verdict} » proposé). ${r.explanation}`.trim(),
        evidenceIds: [],
      };
    }
    return { claimId: c.id, verdict: r.verdict, confidence: r.confidence, explanation: r.explanation, correction: r.correction ?? undefined, evidenceIds };
  });
}

const verdictValue = (v: ClaimVerdict) => (v.verdict === 'inverifiable' ? Infinity : VERDICT_VALUE[v.verdict]);

/**
 * Fusionne plusieurs passages de vérification : pour chaque affirmation, le verdict majoritaire l'emporte
 * (à égalité : un verdict tranché plutôt qu'« invérifiable », puis le plus prudent). L'accord entre passages
 * pondère la confiance, et les sources retenues sont celles des passages qui ont voté pour le verdict final.
 */
export function combineVerdicts(passes: ClaimVerdict[][], claims: Claim[]): ClaimVerdict[] {
  if (passes.length === 1) return passes[0].map((v) => ({ ...v, agreement: 1 }));
  return claims.map((c) => {
    const votes = passes.map((p) => p.find((v) => v.claimId === c.id)).filter((v): v is ClaimVerdict => v !== undefined);
    const groups = new Map<string, ClaimVerdict[]>();
    for (const v of votes) groups.set(v.verdict, [...(groups.get(v.verdict) ?? []), v]);
    const [winner] = [...groups.values()].sort(
      (a, b) =>
        b.length - a.length ||
        Number(a[0].verdict === 'inverifiable') - Number(b[0].verdict === 'inverifiable') ||
        verdictValue(a[0]) - verdictValue(b[0]),
    );
    if (!winner) return { claimId: c.id, verdict: 'inverifiable', confidence: 0, explanation: "Le modèle n'a pas traité cette affirmation.", evidenceIds: [] };
    const agreement = winner.length / votes.length;
    const best = [...winner].sort((a, b) => b.confidence - a.confidence)[0];
    const confidence = (winner.reduce((sum, v) => sum + v.confidence, 0) / winner.length) * agreement;
    return {
      claimId: c.id,
      verdict: best.verdict,
      confidence,
      explanation: best.explanation,
      correction: best.correction,
      evidenceIds: [...new Set(winner.flatMap((v) => v.evidenceIds))],
      agreement,
    };
  });
}

export interface VerifyResult {
  verdicts: ClaimVerdict[];
  model: string;
  /** Verdicts de chaque passage réussi, pour mesurer l'écart entre eux. */
  passes: ClaimVerdict[][];
  failedPasses: number;
}

export interface VerifyOptions {
  today?: string;
  /** Nombre de vérifications indépendantes (défaut : 1). Les passages impairs reçoivent les affirmations dans l'ordre inverse et une température plus haute, pour que l'accord ne soit pas trivial. */
  passes?: number;
  variedTemperature?: number;
}

export async function verifyClaims(
  video: Pick<VideoInput, 'title' | 'author'>,
  claims: Claim[],
  evidence: Evidence[],
  engine: JsonEngine,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const checkable = claims.filter((c) => c.type !== 'opinion');
  if (!checkable.length) return { verdicts: [], model: '', passes: [], failedPasses: 0 };
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const outcomes = await mapLimit(Array.from({ length: Math.max(1, opts.passes ?? 1) }), 2, async (_, i) => {
    const ordered = i % 2 === 0 ? checkable : [...checkable].reverse();
    const callOpts = i % 2 === 0 ? undefined : { temperature: opts.variedTemperature ?? 0.4 };
    try {
      const { data, model } = await engine(buildVerifyMessages(video as VideoInput, ordered, evidence, today), VerifySchema, callOpts);
      return { ok: true as const, verdicts: sanitizeVerdicts(data.verdicts, checkable, evidence), model };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  const done = outcomes.flatMap((o) => (o.ok ? [o] : []));
  if (!done.length) throw (outcomes.find((o) => !o.ok) as { error: unknown }).error;
  const passes = done.map((o) => o.verdicts);
  return { verdicts: combineVerdicts(passes, checkable), model: done[0].model, passes, failedPasses: outcomes.length - done.length };
}
