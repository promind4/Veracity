import { mapLimit } from '../async';
import { type Claim, type Evidence, type FetchFn, type RawEvidence, UserError } from '../types';
import { factCheckSearch } from './factcheck';
import { readSource } from './read';
import { jinaSearch } from './jina';
import { scraperSearch } from './scraperapi';
import { serperSearch } from './serper';

export interface SearchKeys {
  searchProviderOrder?: ('serper' | 'jina' | 'scraperapi')[];
  recentSearchMode?: 'parallel' | 'fallback';
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
  const names = { serper: 'Serper', jina: 'Jina', scraperapi: 'ScraperAPI' };
  return [...new Set<keyof typeof names>(keys.searchProviderOrder ?? ['serper', 'jina', 'scraperapi'])]
    .flatMap((id) => providers.filter((p) => p.name === names[id]));
}

/** Premier fournisseur qui renvoie des r�sultats ; les �checs deviennent des avertissements. */
async function webSearch(q: string, providers: Provider[], warnings: Set<string>, recent = false): Promise<RawEvidence[]> {
  for (const p of providers) {
    try {
      const results = await p.run(q, recent);
      if (results.length) return results;
    } catch (e) {
      warnings.add(`Recherche ${p.name} en �chec : ${(e as Error).message}`);
    }
  }
  return [];
}

const urlKey = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();

// Une vid�o ne peut pas servir de preuve pour une autre vid�o (raisonnement circulaire).
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
): Promise<{ evidence: Evidence[]; warnings: string[]; usage: Record<string, { requests: number; failed: number }> }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const usage: Record<string, { requests: number; failed: number }> = {};
  async function measured<T>(name: string, run: () => Promise<T>): Promise<T> {
    const stats = usage[name] ??= { requests: 0, failed: 0 };
    stats.requests++;
    try { return await run(); } catch (e) { stats.failed++; throw e; }
  }
  const providers = buildProviders(keys, lang, fetchFn).map((p) => ({
    ...p, run: (q: string, recent?: boolean) => measured(p.name, () => p.run(q, recent)),
  }));
  const checkable = claims.filter((c) => c.type !== 'opinion');
  if (!checkable.length) return { evidence: [], warnings: [], usage };
  if (!providers.length) throw new UserError('config', 'Aucune cl� de recherche web configur�e (Serper, Jina ou ScraperAPI).');

  const warnings = new Set<string>();
  let done = 0;
  let pageReads = 0;
  const perClaim = await mapLimit(checkable, opts.concurrency ?? 3, async (claim) => {
    const found: RawEvidence[] = [];
    // Un premier r�sultat ancien ne doit pas masquer une annonce r�cente chez un autre fournisseur.
    if (claim.timeSensitive && keys.recentSearchMode !== 'fallback') {
      const current = await Promise.all(providers.map(async (p) => {
        try {
          return await p.run(claim.queries[0] ?? claim.claim, true);
        } catch (e) {
          warnings.add(`Recherche r�cente ${p.name} en �chec : ${(e as Error).message}`);
          return [];
        }
      }));
      found.push(...dedupe(current.flat()).slice(0, 4));
    }
    if (claim.timeSensitive && keys.recentSearchMode === 'fallback') {
      found.push(...dedupe(await webSearch(claim.queries[0] ?? claim.claim, providers, warnings, true)).slice(0, 4));
    }
    if (keys.factcheckKey) {
      try {
        found.push(...(await measured('Google Fact Check', () => factCheckSearch(claim.queries[0], keys.factcheckKey!, lang, fetchFn))));
      } catch (e) {
        warnings.add(`Google Fact Check en �chec : ${(e as Error).message}`);
      }
    }
    for (const q of claim.queries) found.push(...(await webSearch(q, providers, warnings)));
    const items = dedupe(found).slice(0, MAX_EVIDENCE_PER_CLAIM);
    if (claim.timeSensitive) {
      // Lecture born�e � deux pages pour ne pas multiplier les appels ni les d�lais.
      for (const it of items.filter((item) => item.source !== 'factcheck').slice(0, 2)) {
        if (pageReads >= 12) break;
        pageReads++;
        try {
          const page = await measured('Jina Reader', () => readSource(it.url, keys.jinaKey, fetchFn));
          it.snippet = `${it.snippet}\n\nExtrait de la page : ${page.content}`.slice(0, 3500);
          it.date = page.date ?? it.date;
        } catch {
          warnings.add('Lecture compl�te de certaines sources r�centes impossible ; seuls leurs extraits sont disponibles.');
        }
      }
    }
    opts.onClaimDone?.(++done, checkable.length);
    return { claim, items };
  });

  let n = 0;
  const evidence = perClaim.flatMap(({ claim, items }) => items.map((it) => ({ ...it, id: `E${++n}`, claimId: claim.id, retrievedAt: new Date().toISOString() })));
  return { evidence, warnings: [...warnings], usage };
}
