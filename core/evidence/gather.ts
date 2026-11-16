import { mapLimit } from '../async';
import { type Claim, type Evidence, type FetchFn, type RawEvidence, UserError } from '../types';
import { factCheckSearch } from './factcheck';
import { readSource } from './read';
import { jinaSearch } from './jina';
import { scraperSearch } from './scraperapi';
import { serperSearch } from './serper';

export interface SearchKeys {
  serperKey?: string;
  jinaKey?: string;
  scraperapiKey?: string;
  factcheckKey?: string;
}

interface Provider {
  name: string;
  run: (q: string, recent?: boolean) => Promise<RawEvidence[]>;
}

export const MAX_EVIDENCE_PER_CLAIM = 6;

function buildProviders(keys: SearchKeys, lang: string, fetchFn: FetchFn): Provider[] {
  const providers: Provider[] = [];
  if (keys.serperKey) providers.push({ name: 'Serper', run: (q, recent) => serperSearch(q, keys.serperKey!, lang, fetchFn, recent) });
  if (keys.jinaKey) providers.push({ name: 'Jina', run: (q) => jinaSearch(q, keys.jinaKey!, fetchFn) });
  if (keys.scraperapiKey) providers.push({ name: 'ScraperAPI', run: (q) => scraperSearch(q, keys.scraperapiKey!, lang, fetchFn) });
  return providers;
}

/** Premier fournisseur qui renvoie des résultats ; les échecs deviennent des avertissements. */
async function webSearch(q: string, providers: Provider[], warnings: Set<string>): Promise<RawEvidence[]> {
  for (const p of providers) {
    try {
      const results = await p.run(q);
      if (results.length) return results;
    } catch (e) {
      warnings.add(`Recherche ${p.name} en échec : ${(e as Error).message}`);
    }
  }
  return [];
}

const urlKey = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();

// Une vidéo ne peut pas servir de preuve pour une autre vidéo (raisonnement circulaire).
const VIDEO_HOSTS = /^https?:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|tiktok\.com|dailymotion\.com)\//i;

function dedupe(items: RawEvidence[]): RawEvidence[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = urlKey(it.url);
    if (!it.url || VIDEO_HOSTS.test(it.url) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function gatherEvidence(
  claims: Claim[],
  keys: SearchKeys,
  lang: string,
  opts: { fetchFn?: FetchFn; onClaimDone?: (done: number, total: number) => void; concurrency?: number } = {},
): Promise<{ evidence: Evidence[]; warnings: string[] }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const providers = buildProviders(keys, lang, fetchFn);
  if (!providers.length) throw new UserError('config', 'Aucune clé de recherche web configurée (Serper, Jina ou ScraperAPI).');

  const warnings = new Set<string>();
  const checkable = claims.filter((c) => c.type !== 'opinion');
  let done = 0;
  const perClaim = await mapLimit(checkable, opts.concurrency ?? 3, async (claim) => {
    const found: RawEvidence[] = [];
    // Un premier résultat ancien ne doit pas masquer une annonce récente chez un autre fournisseur.
    if (claim.timeSensitive) {
      const current = await Promise.all(providers.map(async (p) => {
        try {
          return await p.run(claim.queries[0] ?? claim.claim, true);
        } catch (e) {
          warnings.add(`Recherche récente ${p.name} en échec : ${(e as Error).message}`);
          return [];
        }
      }));
      found.push(...dedupe(current.flat()).slice(0, 4));
    }
    if (keys.factcheckKey) {
      try {
        found.push(...(await factCheckSearch(claim.queries[0], keys.factcheckKey, lang, fetchFn)));
      } catch (e) {
        warnings.add(`Google Fact Check en échec : ${(e as Error).message}`);
      }
    }
    for (const q of claim.queries) found.push(...(await webSearch(q, providers, warnings)));
    const items = dedupe(found).slice(0, MAX_EVIDENCE_PER_CLAIM);
    if (claim.timeSensitive) {
      // Lecture bornée à deux pages pour ne pas multiplier les appels ni les délais.
      for (const it of items.filter((item) => item.source !== 'factcheck').slice(0, 2)) {
        try {
          const page = await readSource(it.url, keys.jinaKey, fetchFn);
          it.snippet = `${it.snippet}\n\nExtrait de la page : ${page.content}`.slice(0, 3500);
          it.date = page.date ?? it.date;
        } catch {
          warnings.add('Lecture complète de certaines sources récentes impossible ; seuls leurs extraits sont disponibles.');
        }
      }
    }
    opts.onClaimDone?.(++done, checkable.length);
    return { claim, items };
  });

  let n = 0;
  const evidence = perClaim.flatMap(({ claim, items }) => items.map((it) => ({ ...it, id: `E${++n}`, claimId: claim.id, retrievedAt: new Date().toISOString() })));
  return { evidence, warnings: [...warnings] };
}
