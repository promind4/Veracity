import { describe, expect, it, vi } from 'vitest';
import { buildVerifyMessages, combineVerdicts, sanitizeVerdicts, verifyClaims } from '../core/verify';
import type { Claim, ClaimVerdict, Evidence, VideoInput } from '../core/types';

const claims: Claim[] = [
  { id: 'C1', type: 'fait', claim: 'Shopify fondé en 2006', quote: 'q', timestampS: 0, importance: 2, queries: [] },
  { id: 'C2', type: 'fait', claim: 'TVA supprimée', quote: 'q', timestampS: 0, importance: 3, queries: [] },
  { id: 'C3', type: 'promesse_commerciale', claim: 'Élèves à 5000 €', quote: 'q', timestampS: 0, importance: 2, queries: [] },
];
const evidence: Evidence[] = [
  { id: 'E1', claimId: 'C1', url: 'https://fr.wikipedia.org/wiki/Shopify', title: 'Shopify', snippet: 'Création 2006', source: 'serper' },
  { id: 'E2', claimId: 'C2', url: 'https://afp.fr/x', title: 'AFP', snippet: 'Faux', source: 'factcheck', rating: 'Faux', publisher: 'AFP' },
];

describe('sanitizeVerdicts', () => {
  it('garde seulement les preuves de l’affirmation et normalise les identifiants', () => {
    const out = sanitizeVerdicts(
      [
        { claim_id: 'c1', verdict: 'vrai', confidence: 0.9, explanation: 'ok', correction: null, evidence_ids: ['e1', 'E2', 'E99'] },
        { claim_id: 'C2', verdict: 'faux', confidence: 0.8, explanation: 'non', correction: 'L’UE a supprimé l’exonération', evidence_ids: [] },
      ],
      claims,
      evidence,
    );
    expect(out[0]).toEqual({ claimId: 'C1', verdict: 'vrai', confidence: 0.9, explanation: 'ok', correction: undefined, evidenceIds: ['E1'] });
    expect(out[1]).toMatchObject({ claimId: 'C2', verdict: 'inverifiable', confidence: 0.3, evidenceIds: [] });
    expect(out[1].explanation).toMatch(/^Aucune source/);
    expect(out[2]).toMatchObject({ claimId: 'C3', verdict: 'inverifiable', confidence: 0 });
  });
});

describe('buildVerifyMessages', () => {
  it('liste les preuves par affirmation et signale les fact-checks', () => {
    const video: VideoInput = { videoId: 'v', title: 'T', author: 'A', description: '', durationS: 0, language: 'fr', segments: [] };
    const [, user] = buildVerifyMessages(video, claims, evidence, '2026-10-11');
    expect(user.content).toContain('### C1 (fait) : « Shopify fondé en 2006 »');
    expect(user.content).toContain('[E1] Shopify (fr.wikipedia.org)');
    expect(user.content).toContain('[E2] FACT-CHECK AFP, verdict « Faux »');
    expect(user.content).toContain('### C3 (promesse_commerciale)');
    expect(user.content).toContain('(aucune preuve trouvée)');
    expect(user.content).toContain('2026-10-11');
  });
});

describe('combineVerdicts', () => {
  const claims = [{ id: 'C1' }, { id: 'C2' }] as Claim[];
  const v = (claimId: string, verdict: ClaimVerdict['verdict'], confidence = 0.8, evidenceIds: string[] = []): ClaimVerdict => ({ claimId, verdict, confidence, explanation: verdict, evidenceIds });
  it('un seul passage : verdicts inchangés, accord total', () => {
    expect(combineVerdicts([[v('C1', 'vrai'), v('C2', 'faux')]], claims).map((x) => [x.verdict, x.agreement])).toEqual([['vrai', 1], ['faux', 1]]);
  });
  it('le verdict majoritaire l’emporte, l’accord pondère la confiance, les sources sont celles des votants', () => {
    const passes = [
      [v('C1', 'vrai', 0.9, ['E1']), v('C2', 'faux', 0.8)],
      [v('C1', 'vrai', 0.7, ['E2']), v('C2', 'exagere', 0.6)],
      [v('C1', 'faux', 0.9, ['E3']), v('C2', 'faux', 0.8)],
    ];
    const [c1, c2] = combineVerdicts(passes, claims);
    expect(c1).toMatchObject({ verdict: 'vrai', agreement: 2 / 3, evidenceIds: ['E1', 'E2'] });
    expect(c1.confidence).toBeCloseTo(0.8 * (2 / 3));
    expect(c2).toMatchObject({ verdict: 'faux', agreement: 2 / 3 });
  });
  it('à égalité, un verdict tranché vaut mieux qu’« invérifiable », puis on garde le plus prudent', () => {
    expect(combineVerdicts([[v('C1', 'inverifiable'), v('C2', 'vrai')], [v('C1', 'vrai'), v('C2', 'faux')]], claims).map((x) => x.verdict)).toEqual(['vrai', 'faux']);
  });
});

describe('verifyClaims en plusieurs passages', () => {
  const claims = [{ id: 'C1', type: 'fait', claim: 'a', quote: '', importance: 2, timestampS: 0, queries: [] }] as Claim[];
  const evidence = [{ id: 'E1', claimId: 'C1', url: 'https://x.org', title: 't', snippet: 's', source: 'serper' }] as Evidence[];
  const reply = (verdict: string) => ({ data: { verdicts: [{ claim_id: 'C1', verdict, confidence: 0.9, explanation: '', correction: null, evidence_ids: ['E1'] }] }, model: 'm' });
  it('lance deux passages dont le second est varié, et tolère l’échec de l’un', async () => {
    const engine = vi.fn().mockResolvedValueOnce(reply('vrai')).mockRejectedValueOnce(new Error('saturé'));
    const out = await verifyClaims({ title: 'T', author: 'A' }, claims, evidence, engine as never, { passes: 2 });
    expect(out.passes).toHaveLength(1);
    expect(out.failedPasses).toBe(1);
    expect(engine.mock.calls[1][2]).toEqual({ temperature: 0.4 });
    expect(engine.mock.calls[0][2]).toBeUndefined();
  });
  it('échoue si tous les passages échouent', async () => {
    await expect(verifyClaims({ title: 'T', author: 'A' }, claims, evidence, vi.fn().mockRejectedValue(new Error('hs')) as never, { passes: 2 })).rejects.toThrow('hs');
  });
});
