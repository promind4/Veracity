import type { FetchFn, RawEvidence } from '../types';
import { countryFor } from './lang';

interface ScraperOrganic {
  link: string;
  title?: string;
  snippet?: string;
  displayed_link?: string;
}

/** ScraperAPI renvoie souvent des redirections Google opaques : on reconstruit l'URL depuis le lien affiché. */
export function decodeScraperLink(link: string, displayed?: string): string {
  try {
    const u = new URL(link);
    if (!/(^|\.)google\./.test(u.hostname)) return link;
    const direct = u.searchParams.get('q') ?? u.searchParams.get('url');
    if (direct && /^https?:\/\//.test(direct)) return direct;
  } catch {
    return link;
  }
  if (displayed) {
    const rebuilt = displayed
      .replace(/\s*›\s*/g, '/')
      .replace(/(\.\.\.|…)$/, '')
      .trim();
    if (/^https?:\/\//.test(rebuilt)) return rebuilt;
  }
  return link;
}

export async function scraperSearch(q: string, key: string, lang: string, fetchFn: FetchFn = fetch): Promise<RawEvidence[]> {
  const url =
    'https://api.scraperapi.com/structured/google/search' +
    `?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&hl=${lang}&country_code=${countryFor(lang)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { organic_results?: ScraperOrganic[] } = await res.json();
  return (data.organic_results ?? []).slice(0, 5).map((o) => ({
    url: decodeScraperLink(o.link, o.displayed_link),
    title: o.title ?? '',
    snippet: o.snippet ?? '',
    source: 'scraperapi' as const,
  }));
}
