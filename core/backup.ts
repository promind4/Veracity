// Sauvegarde restaurable : chaque vidéo garde un `veracity.json` dans son dossier de la base de connaissances,
// le lexique vit dans `_Lexique/`. Réinstaller l'extension ne fait donc plus rien perdre.

import type { ChannelReport } from './channel';
import type { ChatTurn } from './chat';
import { frontMatter } from './export';
import type { VideoMeta } from './kb';
import type { Lexicon, LexiconTerm } from './lexicon';
import type { SpeakerMap } from './speakers';
import type { Translation } from './translate';
import type { Report, VideoInput } from './types';

export const VIDEO_DATA_FILE = 'veracity.json';
export const LEXICON_DIR = '_Lexique';
export const LEXICON_DATA_FILE = 'lexique.json';
export const LEXICON_DOC_FILE = 'LEXIQUE.md';
export const LEXICON_CHATS_DIR = 'Discussions';
export const CHANNELS_DIR = '_Chaînes';
export const CHANNEL_DATA_FILE = 'chaine.json';
export const CHANNEL_DOC_FILE = 'chaine.md';
export const BACKUP_VERSION = 1;

export interface VideoBackup {
  version: number;
  savedAt: string;
  videoId: string;
  video?: VideoInput;
  report?: Report;
  chat?: ChatTurn[];
  meta?: VideoMeta;
  translations: Translation[];
  speakers?: SpeakerMap & { signature: string };
  visitedAt?: string;
}

export interface LexiconBackup {
  version: number;
  savedAt: string;
  lexicon: Lexicon;
  chats: Record<string, ChatTurn[]>;
}

/** Clés du stockage de l'extension qui concernent une vidéo. */
export const videoKeys = (videoId: string, langs: string[]) => [
  `video:${videoId}`,
  `report:${videoId}`,
  `chat:${videoId}`,
  `meta:${videoId}`,
  `speakers:${videoId}`,
  `visit:${videoId}`,
  ...langs.map((l) => `translation:${videoId}:${l}`),
];

export function buildVideoBackup(videoId: string, items: Record<string, unknown>, savedAt: string): VideoBackup {
  const translations = Object.entries(items)
    .filter(([k, v]) => k.startsWith(`translation:${videoId}:`) && v)
    .map(([, v]) => v as Translation);
  return {
    version: BACKUP_VERSION,
    savedAt,
    videoId,
    video: items[`video:${videoId}`] as VideoInput | undefined,
    report: items[`report:${videoId}`] as Report | undefined,
    chat: items[`chat:${videoId}`] as ChatTurn[] | undefined,
    meta: items[`meta:${videoId}`] as VideoMeta | undefined,
    translations,
    speakers: items[`speakers:${videoId}`] as VideoBackup['speakers'],
    visitedAt: items[`visit:${videoId}`] as string | undefined,
  };
}

export function parseVideoBackup(raw: unknown): VideoBackup | null {
  const b = raw as Partial<VideoBackup> | null;
  if (!b || typeof b !== 'object' || typeof b.videoId !== 'string' || !/^[\w-]{11}$/.test(b.videoId)) return null;
  return { ...b, version: b.version ?? BACKUP_VERSION, savedAt: b.savedAt ?? '', translations: Array.isArray(b.translations) ? b.translations : [] } as VideoBackup;
}

/**
 * Ce qu'il faut écrire dans le stockage pour restaurer une vidéo, sans jamais écraser du plus récent :
 * on n'importe que ce qui manque, ou ce qui est plus récent (rapport, traduction) ou plus complet (discussion).
 */
export function restorePlan(backup: VideoBackup, local: Record<string, unknown>): Record<string, unknown> {
  const id = backup.videoId;
  const out: Record<string, unknown> = {};
  const newer = (a?: string, b?: string) => Date.parse(a ?? '') > (Date.parse(b ?? '') || 0);
  if (backup.video && !local[`video:${id}`]) out[`video:${id}`] = backup.video;
  const localReport = local[`report:${id}`] as Report | undefined;
  if (backup.report && (!localReport || newer(backup.report.createdAt, localReport.createdAt))) out[`report:${id}`] = backup.report;
  const localChat = (local[`chat:${id}`] as ChatTurn[] | undefined) ?? [];
  if (backup.chat && backup.chat.length > localChat.length) out[`chat:${id}`] = backup.chat;
  if (backup.meta && !local[`meta:${id}`]) out[`meta:${id}`] = backup.meta;
  if (backup.speakers && !local[`speakers:${id}`]) out[`speakers:${id}`] = backup.speakers;
  if (backup.visitedAt && !local[`visit:${id}`]) out[`visit:${id}`] = backup.visitedAt;
  for (const t of backup.translations) {
    const key = `translation:${id}:${t.lang}`;
    const localT = local[key] as Translation | undefined;
    if (!localT || newer(t.createdAt, localT.createdAt)) out[key] = t;
  }
  return out;
}

/** Fusion de deux bibliothèques : pour chaque terme, la version la plus récente l'emporte, les vidéos s'additionnent. */
export function mergeLexicons(local: Lexicon, remote: Lexicon): Lexicon {
  const out: Lexicon = { ...local };
  for (const [id, r] of Object.entries(remote)) {
    const l = out[id];
    if (!l) {
      out[id] = r;
      continue;
    }
    const [base, other]: LexiconTerm[] = Date.parse(r.updatedAt) > Date.parse(l.updatedAt) ? [r, l] : [l, r];
    out[id] = {
      ...base,
      videos: [...base.videos, ...other.videos.filter((v) => !base.videos.some((b) => b.videoId === v.videoId))],
      related: [...new Set([...base.related, ...other.related])].slice(0, 3),
    };
  }
  return out;
}

export function parseLexiconBackup(raw: unknown): LexiconBackup | null {
  const b = raw as Partial<LexiconBackup> | null;
  if (!b || typeof b !== 'object' || !b.lexicon || typeof b.lexicon !== 'object') return null;
  return { version: b.version ?? BACKUP_VERSION, savedAt: b.savedAt ?? '', lexicon: b.lexicon, chats: b.chats ?? {} };
}

/** Discussion d'apprentissage d'un terme, lisible dans la base (`_Lexique/Discussions/<terme>.md`). */
export function tutorChatToMarkdown(term: LexiconTerm, turns: ChatTurn[]): string {
  const body = turns
    .filter((t) => !t.error)
    .map((t) => `### ${t.role === 'user' ? '🙋 Moi' : '🎓 Tuteur'}\n\n${t.content}`)
    .join('\n\n');
  return `${frontMatter({ type: 'discussion-lexique', terme: term.term, domaine: term.domain })}# ${term.term}\n\n${term.definition}\n\n${body}\n`;
}

export function parseChannelBackup(raw: unknown): ChannelReport | null {
  const r = raw as Partial<ChannelReport> | null;
  if (!r || typeof r.channelId !== 'string' || !r.summary || !Array.isArray(r.videos)) return null;
  return r as ChannelReport;
}

/** Garde la version la plus récente de chaque chaîne. */
export function mergeChannels(local: ChannelReport[], remote: ChannelReport[]): ChannelReport[] {
  const byId = new Map(local.map((c) => [c.channelId, c]));
  for (const c of remote) {
    const l = byId.get(c.channelId);
    if (!l || Date.parse(c.createdAt) > Date.parse(l.createdAt)) byId.set(c.channelId, c);
  }
  return [...byId.values()];
}
