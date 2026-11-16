// Analyse d'une chaîne : un échantillon de ses vidéos récentes, noté vidéo par vidéo, puis résumé en une note de chaîne.

import { frontMatter } from './export';
import { TECHNIQUE_LABEL } from './labels';
import type { Reliability, Report, Technique } from './types';

export interface FeedEntry {
  videoId: string;
  title: string;
  published: string;
  views?: number;
}

export interface Feed {
  channelId: string;
  name: string;
  entries: FeedEntry[];
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

/** Flux Atom d'une chaîne (https://www.youtube.com/feeds/videos.xml?channel_id=…) : ses 15 dernières vidéos. */
export function parseFeed(xml: string): Feed {
  const name = decode(xml.match(/<author>\s*<name>([^<]*)<\/name>/)?.[1] ?? xml.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  // Le flux donne l'identifiant de la chaîne sans son préfixe « UC » (les entrées, elles, l'ont).
  const rawId = xml.match(/<yt:channelId>([^<]+)<\/yt:channelId>/)?.[1] ?? '';
  const channelId = rawId && !rawId.startsWith('UC') ? `UC${rawId}` : rawId;
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    videoId: e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? '',
    title: decode(e.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''),
    published: e.match(/<published>([^<]+)<\/published>/)?.[1] ?? '',
    views: Number(e.match(/<media:statistics views="(\d+)"/)?.[1]) || undefined,
  }));
  return { channelId, name, entries: entries.filter((e) => e.videoId) };
}

export const feedUrl = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

const CHANNEL_ID = /^UC[\w-]{22}$/;

/** Ce que l'adresse d'une page YouTube dit de la chaîne : son identifiant, ou son @identifiant à résoudre. */
export function parseChannelUrl(url: string): { channelId?: string; handle?: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('youtube.com')) return null;
    const channel = u.pathname.match(/^\/channel\/(UC[\w-]{22})/);
    if (channel) return { channelId: channel[1] };
    const handle = u.pathname.match(/^\/(@[^/]+)/);
    if (handle) return { handle: decodeURIComponent(handle[1]) };
  } catch {
    // adresse invalide
  }
  return null;
}

/** Identifiant de chaîne lu dans le code d'une page de chaîne ou de vidéo. */
export function channelIdFromHtml(html: string): string | null {
  const patterns = [/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/, /"externalId":"(UC[\w-]{22})"/, /"channelId":"(UC[\w-]{22})"/, /channel_id=(UC[\w-]{22})/];
  for (const p of patterns) {
    const id = html.match(p)?.[1];
    if (id && CHANNEL_ID.test(id)) return id;
  }
  return null;
}

/**
 * Vidéos à essayer, dans l'ordre : on mélange récentes et populaires pour ne pas juger la chaîne sur sa seule dernière
 * vidéo. Les plus vues viennent en premier quand le flux les donne, puis les plus récentes, en alternance.
 */
export function candidateOrder(entries: FeedEntry[]): FeedEntry[] {
  const recent = [...entries].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  const popular = [...entries].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const out: FeedEntry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (const e of [recent[i], popular[i]]) {
      if (e && !seen.has(e.videoId)) {
        seen.add(e.videoId);
        out.push(e);
      }
    }
  }
  return out;
}

export interface ChannelVideo {
  videoId: string;
  title: string;
  published?: string;
  facts: number | null;
  discourse: number;
  label: string;
  reliability?: Reliability;
  verified: number;
  techniques: Technique[];
}

export function channelVideoOf(report: Report, published?: string): ChannelVideo {
  return {
    videoId: report.videoId,
    title: report.title,
    published,
    facts: report.scores.facts,
    discourse: report.scores.discourse,
    label: report.scores.label,
    reliability: report.scores.reliability,
    verified: report.verdicts.filter((v) => v.verdict !== 'inverifiable').length,
    techniques: [...new Set(report.rhetoric.map((r) => r.technique))],
  };
}

export type ChannelVerdict = 'fiable' | 'orientee' | 'mitigee' | 'peu_fiable' | 'commerciale' | 'insuffisant';

export interface ChannelSummary {
  verdict: ChannelVerdict;
  label: string;
  advice: string;
  /** Score des faits médian des vidéos évaluables (null si aucune). */
  facts: number | null;
  discourse: number;
  /** Vidéos dont les faits n'ont pas pu être évalués (peu d'affirmations vérifiables). */
  unevaluable: number;
  /** Écart entre la meilleure et la moins bonne vidéo (faits). */
  spread: number;
  /** Vidéos dont le score des faits est inférieur de plus de 35 points à la médiane : à regarder une à une. */
  outliers: string[];
  confidence: Reliability;
  /** Procédés de persuasion les plus fréquents : vidéos concernées sur l'échantillon. */
  techniques: { technique: Technique; videos: number }[];
}

export const MIN_VIDEOS = 3;

const CHANNEL_TEXT: Record<ChannelVerdict, { label: string; advice: string }> = {
  fiable: { label: 'Chaîne fiable', advice: 'Elle vaut le coup : faits exacts et discours honnête sur l’échantillon.' },
  orientee: { label: 'Faits corrects, discours très orienté', advice: 'Le fond tient, mais la chaîne pousse à l’achat ou à l’adhésion : regarde avec recul.' },
  mitigee: { label: 'Chaîne mitigée', advice: 'Résultats inégaux : vérifie les affirmations importantes avant de t’y fier.' },
  peu_fiable: { label: 'Chaîne peu fiable', advice: 'Beaucoup d’affirmations fausses ou exagérées : ne perds pas ton temps, ou recoupe tout.' },
  commerciale: { label: 'Chaîne commerciale', advice: 'Discours de vente dominant et peu de faits vérifiables : probablement un entonnoir de vente plus qu’une information.' },
  insuffisant: { label: 'Échantillon insuffisant', advice: `Moins de ${MIN_VIDEOS} vidéos évaluées : analyse-en davantage pour avoir un avis.` },
};

/**
 * Médiane et non moyenne : une vidéo atypique (interview sur l'actualité brûlante, cas limite de la vérification)
 * ne doit pas faire basculer le verdict d'une chaîne dont les autres vidéos sont solides. Elle reste signalée.
 */
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Math.round(sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2);
};

export function verdictOf(facts: number | null, discourse: number, evaluated: number): ChannelVerdict {
  if (evaluated < MIN_VIDEOS) return 'insuffisant';
  if (discourse < 50 && (facts === null || facts < 65)) return 'commerciale';
  if (facts !== null && facts < 45) return 'peu_fiable';
  if (facts !== null && facts >= 75 && discourse >= 70) return 'fiable';
  if (facts !== null && facts >= 60 && discourse < 60) return 'orientee';
  return 'mitigee';
}

export function summarizeChannel(videos: ChannelVideo[]): ChannelSummary {
  const withFacts = videos.filter((v) => v.facts !== null).map((v) => v.facts as number);
  const facts = withFacts.length ? median(withFacts) : null;
  const discourse = median(videos.map((v) => v.discourse));
  const verdict = verdictOf(facts, discourse, videos.length);
  const spread = withFacts.length ? Math.max(...withFacts) - Math.min(...withFacts) : 0;
  const weak = videos.filter((v) => v.reliability === 'faible').length;
  const levels: Reliability[] = ['faible', 'moyenne', 'haute'];
  const base = videos.length >= 6 && spread <= 30 ? 2 : videos.length >= MIN_VIDEOS ? 1 : 0;
  // Des notes individuelles peu fiables pour plus de la moitié des vidéos font baisser la confiance d'un cran.
  const confidence = levels[Math.max(0, base - (weak > videos.length / 2 ? 1 : 0))];
  const counts = new Map<Technique, number>();
  for (const v of videos) for (const t of v.techniques) counts.set(t, (counts.get(t) ?? 0) + 1);
  const techniques = [...counts.entries()]
    .map(([technique, n]) => ({ technique, videos: n }))
    .sort((a, b) => b.videos - a.videos)
    .slice(0, 4);
  const outliers = facts === null ? [] : videos.filter((v) => v.facts !== null && facts - v.facts > 35).map((v) => v.videoId);
  const text = CHANNEL_TEXT[verdict];
  const note = outliers.length && verdict !== 'insuffisant' ? ` ${outliers.length} vidéo(s) de l’échantillon sont nettement en dessous : regarde leur détail avant de conclure.` : '';
  return { verdict, label: text.label, advice: text.advice + note, facts, discourse, unevaluable: videos.length - withFacts.length, spread, outliers, confidence, techniques };
}

export interface ChannelReport {
  version: 1;
  channelId: string;
  name: string;
  createdAt: string;
  videos: ChannelVideo[];
  /** Vidéos écartées (courtes, sans sous-titres…), avec la raison. */
  skipped: { videoId: string; title: string; reason: string }[];
  summary: ChannelSummary;
  warnings: string[];
}

export function buildChannelReport(feed: Pick<Feed, 'channelId' | 'name'>, videos: ChannelVideo[], skipped: ChannelReport['skipped'], warnings: string[], now: string): ChannelReport {
  return { version: 1, channelId: feed.channelId, name: feed.name, createdAt: now, videos, skipped, summary: summarizeChannel(videos), warnings };
}

export interface ChannelDeps {
  fetchFeed(channelId: string): Promise<Feed>;
  /** Rapport déjà calculé pour cette vidéo, s'il existe (aucune requête d'IA dans ce cas). */
  cachedReport(videoId: string): Promise<Report | null>;
  /** Analyse la vidéo ; renvoie la raison de l'écart (courte, sans sous-titres…) au lieu d'un rapport quand elle est ignorée. */
  analyze(entry: FeedEntry): Promise<Report | { skip: string }>;
  onProgress?(done: number, total: number, detail: string): void;
  isCancelled?(): boolean;
  now?(): string;
}

const isQuotaError = (e: unknown) => (e as { code?: string })?.code === 'quota' || /quota|épuisé|surchargé|saturé|tous les modèles/i.test((e as Error)?.message ?? '');

/**
 * Note la chaîne sur `sample` vidéos. Les vidéos déjà analysées ne coûtent rien ; une vidéo écartée est remplacée par la
 * suivante. Si l'IA n'est plus disponible (quota du jour), on s'arrête là : les rapports faits sont gardés, relancer reprend.
 */
export async function analyzeChannel(channelId: string, sample: number, deps: ChannelDeps): Promise<ChannelReport> {
  const feed = await deps.fetchFeed(channelId);
  if (!feed.entries.length) throw new Error('Cette chaîne n’a aucune vidéo récente à analyser.');
  const videos: ChannelVideo[] = [];
  const skipped: ChannelReport['skipped'] = [];
  const warnings: string[] = [];
  const candidates = candidateOrder(feed.entries);
  for (const entry of candidates) {
    if (videos.length >= sample || deps.isCancelled?.()) break;
    deps.onProgress?.(videos.length, sample, entry.title);
    const cached = await deps.cachedReport(entry.videoId);
    if (cached) {
      videos.push(channelVideoOf(cached, entry.published));
      continue;
    }
    try {
      const out = await deps.analyze(entry);
      if ('skip' in out) skipped.push({ videoId: entry.videoId, title: entry.title, reason: out.skip });
      else videos.push(channelVideoOf(out, entry.published));
    } catch (e) {
      if (isQuotaError(e)) {
        warnings.push(`Analyse interrompue après ${videos.length} vidéo(s) : ${(e as Error).message.slice(0, 160)} Relance plus tard, les vidéos déjà analysées ne seront pas refaites.`);
        break;
      }
      skipped.push({ videoId: entry.videoId, title: entry.title, reason: (e as Error).message.slice(0, 120) });
    }
  }
  if (deps.isCancelled?.()) warnings.push('Analyse arrêtée à ta demande : la note porte sur les vidéos déjà analysées.');
  deps.onProgress?.(videos.length, sample, '');
  if (videos.length < sample && !warnings.length) warnings.push(`Seulement ${videos.length} vidéo(s) analysable(s) parmi les ${feed.entries.length} dernières de la chaîne.`);
  return buildChannelReport(feed, videos, skipped, warnings, deps.now?.() ?? new Date().toISOString());
}

/** Compte-rendu lisible, rangé dans la base : `_Chaînes/<nom [id]>/chaine.md`. */
export function channelToMarkdown(r: ChannelReport): string {
  const s = r.summary;
  const rows = r.videos.map(
    (v) =>
      `- [${v.title}](https://www.youtube.com/watch?v=${v.videoId}) — faits ${v.facts === null ? 'non évaluable' : `${v.facts} %`}, discours ${v.discourse} %${v.reliability ? ` (fiabilité ${v.reliability})` : ''}`,
  );
  const techniques = s.techniques.map((t) => `${TECHNIQUE_LABEL[t.technique]} (${t.videos}/${r.videos.length} vidéos)`);
  return `${frontMatter({
    type: 'chaine',
    chaine: r.name,
    chaine_id: r.channelId,
    url: `https://www.youtube.com/channel/${r.channelId}`,
    verdict: s.label,
    score_faits: s.facts,
    score_discours: s.discourse,
    videos_analysees: r.videos.length,
    confiance: s.confidence,
    analyse_le: r.createdAt.slice(0, 10),
  })}# ${r.name}

**${s.label}** · Faits (médiane) : ${s.facts === null ? '—' : `${s.facts} %`} · Discours (médiane) : ${s.discourse} % · Confiance : ${s.confidence} (${r.videos.length} vidéos)

${s.advice}

${techniques.length ? `## Procédés de persuasion les plus fréquents\n\n${techniques.map((t) => `- ${t}`).join('\n')}\n\n` : ''}## Vidéos analysées\n\n${rows.join('\n') || '(aucune)'}\n${
    r.skipped.length ? `\n## Écartées\n\n${r.skipped.map((v) => `- ${v.title} — ${v.reason}`).join('\n')}\n` : ''
  }${r.warnings.length ? `\n## Avertissements\n\n${r.warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}
_Écart entre la meilleure et la moins bonne vidéo (faits) : ${s.spread} points._
`;
}

export const CHANNEL_INDEX_KEY = 'channelIndex';

/** Résumé d'une chaîne analysée, lu par le script de la page YouTube pour afficher son verdict près du nom. */
export interface ChannelIndexEntry {
  channelId: string;
  name: string;
  verdict: ChannelVerdict;
  label: string;
  facts: number | null;
  discourse: number;
  videos: number;
}

export type ChannelIndex = Record<string, ChannelIndexEntry>;

/** Clé de recherche par nom de chaîne (la page YouTube n'affiche que le nom) : sans accents, casse ni espaces. */
export const channelKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const channelIndexEntry = (r: ChannelReport): ChannelIndexEntry => ({
  channelId: r.channelId,
  name: r.name,
  verdict: r.summary.verdict,
  label: r.summary.label,
  facts: r.summary.facts,
  discourse: r.summary.discourse,
  videos: r.videos.length,
});

export function buildChannelIndex(items: Record<string, unknown>): ChannelIndex {
  const index: ChannelIndex = {};
  for (const [key, value] of Object.entries(items)) {
    const r = value as ChannelReport | null;
    if (key.startsWith('channel:') && r?.summary && r.name) index[channelKey(r.name)] = channelIndexEntry(r);
  }
  return index;
}
