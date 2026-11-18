import type { FetchFn } from '../types';

/** Lit une page source quand une annonce récente exige plus qu'un extrait de recherche. */
export async function readSource(url: string, key: string | undefined, fetchFn: FetchFn = fetch): Promise<{ content: string; date?: string }> {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('URL de source non prise en charge');
  const res = await fetchFn('https://r.jina.ai/', {
    method: 'POST',
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, noCache: true }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload: { data?: { content?: string; publishedTime?: string } } = await res.json();
  const text = payload.data?.content?.trim() ?? '';
  if (!text) throw new Error('Page vide');
  const published = payload.data?.publishedTime;
  return { content: text.slice(0, 3000), ...(published ? { date: published } : {}) };
}
