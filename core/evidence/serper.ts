import type { FetchFn, RawEvidence } from '../types';
import { countryFor } from './lang';

interface SerperOrganic {
  link: string;
  title?: string;
  snippet?: string;
  date?: string;
}

export async function serperSearch(q: string, key: string, lang: string, fetchFn: FetchFn = fetch, recent = false): Promise<RawEvidence[]> {
  const res = await fetchFn('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: countryFor(lang), hl: lang, num: 5, ...(recent ? { tbs: 'qdr:w' } : {}) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { organic?: SerperOrganic[] } = await res.json();
  return (data.organic ?? []).slice(0, 5).map((o) => ({
    url: o.link,
    title: o.title ?? '',
    snippet: o.snippet ?? '',
    date: o.date,
    source: 'serper' as const,
  }));
}
