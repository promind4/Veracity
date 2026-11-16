import { describe, expect, it, vi } from 'vitest';
import { gatherEvidence } from '../core/evidence/gather';
import { decodeScraperLink } from '../core/evidence/scraperapi';
import type { Claim } from '../core/types';

describe('decodeScraperLink', () => {
  it('garde un lien direct', () => {
    expect(decodeScraperLink('https://site.fr/page')).toBe('https://site.fr/page');
  });
  it('lit le paramètre q d’une redirection Google', () => {
    expect(decodeScraperLink('https://www.google.com/url?q=https://site.fr/a&sa=U')).toBe('https://site.fr/a');
  });
  it('reconstruit le lien depuis le lien affiché quand la redirection est opaque', () => {
    expect(decodeScraperLink('https://www.google.fr/goto?url=CAESYAHr', 'https://fr.wikipedia.org › wiki › Shopify')).toBe('https://fr.wikipedia.org/wiki/Shopify');
  });
});

const claim = (id: string, type: Claim['type'], queries: string[]): Claim => ({ id, type, queries, timestampS: 0, quote: '', claim: id, importance: 2 });

describe('gatherEvidence', () => {
  it('bascule de Serper vers Jina, ajoute les fact-checks, ignore les opinions et numérote', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('serper')) return new Response('down', { status: 500 });
      if (url.includes('s.jina.ai')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://a.fr/', title: 'A', description: 'extrait A', date: '2024-01-01' }, { url: 'https://a.fr', title: 'A bis' }] }));
      }
      if (url.includes('factchecktools')) {
        return new Response(JSON.stringify({ claims: [{ text: 'X', claimReview: [{ url: 'https://afp.fr/x', title: 'AFP', textualRating: 'Faux', publisher: { name: 'AFP Factuel' } }] }] }));
      }
      throw new Error('URL inattendue ' + url);
    });
    const claims = [claim('C1', 'fait', ['q1']), claim('C2', 'opinion', ['q2'])];
    const progress: string[] = [];
    const { evidence, warnings } = await gatherEvidence(claims, { serperKey: 's', jinaKey: 'j', factcheckKey: 'g' }, 'fr', {
      fetchFn: fetchFn as typeof fetch,
      onClaimDone: (done, total) => progress.push(`${done}/${total}`),
    });
    expect(evidence.map((e) => [e.id, e.claimId, e.source, e.url])).toEqual([
      ['E1', 'C1', 'factcheck', 'https://afp.fr/x'],
      ['E2', 'C1', 'jina', 'https://a.fr/'],
    ]);
    expect(evidence[0]).toMatchObject({ rating: 'Faux', publisher: 'AFP Factuel' });
    expect(warnings).toEqual(['Recherche Serper en échec : HTTP 500']);
    expect(progress).toEqual(['1/1']);
  });

  it('écarte les vidéos (YouTube, TikTok) comme sources', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ organic: [{ link: 'https://www.youtube.com/watch?v=x' }, { link: 'https://youtu.be/x' }, { link: 'https://www.tiktok.com/@a/video/1' }, { link: 'https://insee.fr/a' }] })),
    );
    const { evidence } = await gatherEvidence([claim('C1', 'fait', ['q'])], { serperKey: 's' }, 'fr', { fetchFn: fetchFn as typeof fetch });
    expect(evidence.map((e) => e.url)).toEqual(['https://insee.fr/a']);
  });

  it('pour une annonce récente, interroge plusieurs fournisseurs, lit les pages et garde les dates distinctes', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('google.serper.dev')) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ organic: [body.tbs
          ? { link: 'https://éditeur.example/annonce', title: 'Annonce', snippet: 'Nouveau modèle', date: '2026-11-16' }
          : { link: 'https://old.example/v1', title: 'Ancien', snippet: 'Ancien modèle', date: '2024-01-01' }] }));
      }
      if (url.includes('s.jina.ai')) return new Response(JSON.stringify({ data: [{ url: 'https://autre.example/news', title: 'Autre', description: 'Confirmation' }] }));
      if (url.includes('r.jina.ai')) return new Response(JSON.stringify({ data: { content: 'Texte complet de la page', publishedTime: '2026-11-16' } }));
      throw new Error('URL inattendue ' + url);
    });
    const recent = { ...claim('C1', 'fait', ['Nouveau modèle éditeur']), timeSensitive: true };
    const { evidence } = await gatherEvidence([recent], { serperKey: 's', jinaKey: 'j' }, 'fr', { fetchFn: fetchFn as typeof fetch });
    const searches = fetchFn.mock.calls.filter(([url]) => String(url).includes('google.serper.dev'));
    expect(searches.some(([, init]) => JSON.parse(String(init?.body)).tbs === 'qdr:w')).toBe(true);
    expect(evidence.map((e) => e.url)).toEqual(['https://éditeur.example/annonce', 'https://autre.example/news', 'https://old.example/v1']);
    expect(evidence[0].snippet).toContain('Texte complet de la page');
    expect(evidence[0].date).toBe('2026-11-16');
    expect(evidence[0].retrievedAt).toEqual(expect.any(String));
  });

  it('conserve les résultats si la lecture de la page récente échoue', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('r.jina.ai')) return new Response('indisponible', { status: 503 });
      return new Response(JSON.stringify({ organic: [{ link: 'https://source.example/annonce', title: 'Annonce', snippet: 'Modèle disponible' }] }));
    });
    const { evidence, warnings } = await gatherEvidence(
      [{ ...claim('C1', 'fait', ['nouveau modèle']), timeSensitive: true }],
      { serperKey: 's' }, 'fr', { fetchFn: fetchFn as typeof fetch },
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].snippet).toBe('Modèle disponible');
    expect(warnings).toContain('Lecture complète de certaines sources récentes impossible ; seuls leurs extraits sont disponibles.');
  });

  it('exige au moins une clé de recherche', async () => {
    await expect(gatherEvidence([claim('C1', 'fait', ['q'])], {}, 'fr')).rejects.toMatchObject({ code: 'config' });
  });
});
