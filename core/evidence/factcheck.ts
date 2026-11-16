import type { FetchFn, RawEvidence } from '../types';

interface FactCheckClaim {
  text?: string;
  claimant?: string;
  claimReview?: { url?: string; title?: string; textualRating?: string; reviewDate?: string; publisher?: { name?: string; site?: string } }[];
}

export async function factCheckSearch(q: string, key: string, lang: string, fetchFn: FetchFn = fetch): Promise<RawEvidence[]> {
  const url =
    'https://factchecktools.googleapis.com/v1alpha1/claims:search' +
    `?query=${encodeURIComponent(q)}&languageCode=${lang}&pageSize=3&key=${encodeURIComponent(key)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: { claims?: FactCheckClaim[] } = await res.json();
  return (data.claims ?? []).flatMap((c) => {
    const review = c.claimReview?.[0];
    if (!review?.url) return [];
    return [
      {
        url: review.url,
        title: review.title ?? c.text ?? '',
        snippet: `Affirmation déjà vérifiée : « ${c.text ?? ''} »${c.claimant ? ` (${c.claimant})` : ''}. Verdict du fact-checker : ${review.textualRating ?? '?'}.`,
        date: review.reviewDate?.slice(0, 10),
        source: 'factcheck' as const,
        rating: review.textualRating,
        publisher: review.publisher?.name ?? review.publisher?.site,
      },
    ];
  });
}
