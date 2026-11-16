import type { FetchFn, RawEvidence } from '../types';

interface JinaResult {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  date?: string | null;
}

export async function jinaSearch(q: string, key: string, fetchFn: FetchFn = fetch): Promise<RawEvidence[]> {
  const res = await fetchFn(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'X-Respond-With': 'no-content' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { data?: JinaResult[] } = await res.json();
  return (data.data ?? []).slice(0, 5).map((o) => ({
    url: o.url,
    title: o.title ?? '',
    snippet: (o.description || o.content || '').slice(0, 1500),
    date: o.date ?? undefined,
    source: 'jina' as const,
  }));
}
