import type { ChatTurn } from './chat';
import type { KbKind, VideoMeta } from './kb';
import { hostOf, TECHNIQUE_LABEL, VERDICT_LABEL } from './labels';
import { TARGET_LANGUAGES, type Translation } from './translate';
import type { Report, VideoInput } from './types';
import { formatTime, groupSegments } from './youtube';

export const videoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

type FrontMatterValue = string | number | string[] | null | undefined;

/** En-tête YAML (chaînes au format JSON, valide en YAML) ; les valeurs vides sont omises. */
export function frontMatter(fields: Record<string, FrontMatterValue>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(', ')}]` : typeof v === 'number' ? v : JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

const KIND_LABEL: Record<KbKind, string> = { report: 'rapport', chat: 'discussion', transcript: 'transcription', translation: 'traduction' };

/** Document de la base de connaissances : métadonnées de la vidéo + corps Markdown. */
export function kbDocument(kind: KbKind, video: VideoInput, meta: VideoMeta, body: string, report: Report | null, savedAt: string): string {
  return (
    frontMatter({
      type: KIND_LABEL[kind],
      titre: video.title,
      chaine: video.author,
      url: videoUrl(video.videoId),
      video_id: video.videoId,
      duree: formatTime(video.durationS),
      categorie: meta.category,
      tags: meta.tags,
      enregistre_le: savedAt,
      verdict: report?.scores.label,
      score_faits: report?.scores.facts,
      score_discours: report?.scores.discourse,
      fiabilite_note: report?.scores.reliability,
    }) + body
  );
}

export function transcriptToText(video: VideoInput): string {
  const lines = groupSegments(video.segments, 30).map((b) => `[${formatTime(b.start)}] ${b.text}`);
  return `${video.title}\n${video.author} · ${videoUrl(video.videoId)}\n\n${lines.join('\n')}\n`;
}

export function transcriptToMarkdown(video: VideoInput): string {
  const url = videoUrl(video.videoId);
  const blocks = groupSegments(video.segments, 30).map((b) => `**[${formatTime(b.start)}](${url}&t=${b.start}s)** ${b.text}`);
  return `# ${video.title}\n\n*${video.author}* · ${url}\n\n${blocks.join('\n\n')}\n`;
}

export function translationToMarkdown(video: VideoInput, tr: Translation): string {
  const url = videoUrl(video.videoId);
  const blocks = groupSegments(tr.cues.map((c) => ({ start: c.start, text: c.text })), 30).map(
    (b) => `**[${formatTime(b.start)}](${url}&t=${Math.floor(b.start)}s)** ${b.text}`,
  );
  return `# ${video.title} — traduction (${TARGET_LANGUAGES[tr.lang] ?? tr.lang})\n\n*${video.author}* · ${url}\n\n${blocks.join('\n\n')}\n`;
}

export function reportToMarkdown(r: Report): string {
  const verdicts = new Map(r.verdicts.map((v) => [v.claimId, v]));
  const evidence = new Map(r.evidence.map((e) => [e.id, e]));
  const facts = r.claims.filter((c) => c.type !== 'opinion');
  const opinions = r.claims.filter((c) => c.type === 'opinion');
  const out: string[] = [
    `# Veracity — ${r.title}`,
    `**${r.scores.label}** · Faits : ${r.scores.facts ?? '—'} % · Discours : ${r.scores.discourse} % · Couverture : ${Math.round(r.scores.coverage * 100)} %${r.scores.reliability ? ` · Fiabilité de la note : ${r.scores.reliability}` : ''}${r.scores.range ? ` (écart entre passages : ${r.scores.range[0]}–${r.scores.range[1]} %)` : ''}`,
    `${r.author} · ${videoUrl(r.videoId)} · analysé le ${r.createdAt.slice(0, 10)} (${r.models.join(', ')})`,
    `## Résumé\n\n${r.summary}`,
    '## Affirmations',
  ];
  for (const c of facts) {
    const v = verdicts.get(c.id);
    const parts = [`### [${formatTime(c.timestampS)}] ${VERDICT_LABEL[v?.verdict ?? 'inverifiable']} — ${c.claim}`];
    if (c.quote) parts.push(`> « ${c.quote} »`);
    if (v?.explanation) parts.push(v.explanation);
    if (v?.correction) parts.push(`**Correction :** ${v.correction}`);
    const sources = (v?.evidenceIds ?? []).map((id) => evidence.get(id)).filter((e) => e !== undefined);
    if (sources.length) parts.push(sources.map((e) => `- [${e.title || hostOf(e.url)}](${e.url}) (${hostOf(e.url)}${e.date ? `, ${e.date}` : ''})`).join('\n'));
    out.push(parts.join('\n\n'));
  }
  if (r.rhetoric.length) {
    out.push('## Discours et persuasion');
    out.push(r.rhetoric.map((x) => `- **[${formatTime(x.timestampS)}] ${TECHNIQUE_LABEL[x.technique]}** — « ${x.quote} » : ${x.explanation}`).join('\n'));
  }
  if (opinions.length) {
    out.push('## Opinions (non vérifiées)');
    out.push(opinions.map((c) => `- [${formatTime(c.timestampS)}] ${c.claim}`).join('\n'));
  }
  if (r.warnings.length) out.push(`## Avertissements\n\n${r.warnings.map((w) => `- ${w}`).join('\n')}`);
  return out.join('\n\n') + '\n';
}

export function chatToMarkdown(video: Pick<VideoInput, 'title' | 'videoId'>, turns: ChatTurn[]): string {
  const body = turns
    .filter((t) => !t.error)
    .map((t) => `## ${t.role === 'user' ? 'Question' : 'Réponse'}\n\n${t.content}`)
    .join('\n\n');
  return `# Discussion — ${video.title}\n\n${videoUrl(video.videoId)}\n\n${body}\n`;
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'video';
}
