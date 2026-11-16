import type { ChatTurn } from '../../../core/chat';
import { videoKeys } from '../../../core/backup';
import { buildChannelIndex, CHANNEL_INDEX_KEY, type ChannelReport } from '../../../core/channel';
import { buildScoreIndex, entryOf, SCORE_INDEX_KEY, type ScoreIndex } from '../../../core/scoreIndex';
import type { Lexicon } from '../../../core/lexicon';
import type { VideoMeta } from '../../../core/kb';
import type { SpeakerMap } from '../../../core/speakers';
import { TARGET_LANGUAGES, type Translation } from '../../../core/translate';
import { type Config, DEFAULT_MODELS, type Report, type VideoInput } from '../../../core/types';

async function getItem<T>(key: string): Promise<T | null> {
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as T | undefined) ?? null;
}

export async function loadConfig(): Promise<Config> {
  const config = await getItem<Partial<Config>>('config');
  return { openrouterKey: '', models: DEFAULT_MODELS, ...(config ?? {}) };
}

export async function saveConfig(config: Config): Promise<void> {
  await chrome.storage.local.set({ config });
}

export const getCachedReport = (videoId: string) => getItem<Report>(`report:${videoId}`);
export async function saveReport(report: Report): Promise<void> {
  const index = (await getItem<ScoreIndex>(SCORE_INDEX_KEY)) ?? {};
  await chrome.storage.local.set({ [`report:${report.videoId}`]: report, [SCORE_INDEX_KEY]: { ...index, [report.videoId]: entryOf(report) } });
}

export const getCachedVideo = (videoId: string) => getItem<VideoInput>(`video:${videoId}`);
export const saveVideo = (video: VideoInput) => chrome.storage.local.set({ [`video:${video.videoId}`]: video });

export async function getChat(videoId: string): Promise<ChatTurn[]> {
  return (await getItem<ChatTurn[]>(`chat:${videoId}`)) ?? [];
}
export const saveChat = (videoId: string, turns: ChatTurn[]) => chrome.storage.local.set({ [`chat:${videoId}`]: turns });

export const getVideoMeta = (videoId: string) => getItem<VideoMeta>(`meta:${videoId}`);
export const saveVideoMeta = (videoId: string, meta: VideoMeta) => chrome.storage.local.set({ [`meta:${videoId}`]: meta });

export const getTranslation = (videoId: string, lang: string) => getItem<Translation>(`translation:${videoId}:${lang}`);
export const saveTranslation = (videoId: string, tr: Translation) => chrome.storage.local.set({ [`translation:${videoId}:${tr.lang}`]: tr });

/** Intervenants détectés, valables pour une liste de sous-titres donnée (même nombre, même début). */
export interface StoredSpeakers extends SpeakerMap {
  signature: string;
}
export const getSpeakers = (videoId: string) => getItem<StoredSpeakers>(`speakers:${videoId}`);
export const saveSpeakers = (videoId: string, value: StoredSpeakers) => chrome.storage.local.set({ [`speakers:${videoId}`]: value });

/** Bibliothèque de termes (commune à toutes les vidéos) et discussions d'apprentissage, une par terme. */
export async function getLexicon(): Promise<Lexicon> {
  return (await getItem<Lexicon>('lexicon')) ?? {};
}
export const saveLexicon = (lexicon: Lexicon) => chrome.storage.local.set({ lexicon });
export async function getTutorChat(termId: string): Promise<ChatTurn[]> {
  return (await getItem<ChatTurn[]>(`lexchat:${termId}`)) ?? [];
}
export const saveTutorChat = (termId: string, turns: ChatTurn[]) => chrome.storage.local.set({ [`lexchat:${termId}`]: turns });
export const deleteTutorChat = (termId: string) => chrome.storage.local.remove(`lexchat:${termId}`);

/** Analyses de chaînes, et leur index (nom → verdict) lu par la page YouTube. */
export const getChannel = (channelId: string) => getItem<ChannelReport>(`channel:${channelId}`);
export async function saveChannel(report: ChannelReport): Promise<void> {
  await chrome.storage.local.set({ [`channel:${report.channelId}`]: report });
  await rebuildChannelIndex();
}
export async function deleteChannel(channelId: string): Promise<void> {
  await chrome.storage.local.remove(`channel:${channelId}`);
  await rebuildChannelIndex();
}
export async function listChannels(): Promise<ChannelReport[]> {
  return Object.entries(await getAllItems())
    .filter(([k]) => k.startsWith('channel:'))
    .map(([, v]) => v as ChannelReport)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export async function rebuildChannelIndex(): Promise<void> {
  await chrome.storage.local.set({ [CHANNEL_INDEX_KEY]: buildChannelIndex(await getAllItems()) });
}

/** Note la consultation d'une vidéo (pour trier l'historique). */
export const markVisited = (videoId: string) => chrome.storage.local.set({ [`visit:${videoId}`]: new Date().toISOString() });

/** Tout ce que l'extension garde sur une vidéo (pour la sauvegarde). */
export async function collectVideoItems(videoId: string): Promise<Record<string, unknown>> {
  return chrome.storage.local.get(videoKeys(videoId, Object.keys(TARGET_LANGUAGES)));
}

export const getAllItems = () => chrome.storage.local.get(null) as Promise<Record<string, unknown>>;

const VIDEO_PREFIXES = ['video', 'report', 'chat', 'meta', 'speakers', 'visit'];

/** Efface tout ce que l'extension garde sur une vidéo (pas les fichiers de la base de connaissances). */
export async function deleteVideoData(videoId: string): Promise<void> {
  const keys = Object.keys(await getAllItems()).filter((k) => {
    const [kind, id] = k.split(':');
    return id === videoId && (VIDEO_PREFIXES.includes(kind) || kind === 'translation');
  });
  await chrome.storage.local.remove(keys);
  const index = await getItem<ScoreIndex>(SCORE_INDEX_KEY);
  if (index?.[videoId]) {
    const { [videoId]: _gone, ...rest } = index;
    await chrome.storage.local.set({ [SCORE_INDEX_KEY]: rest });
  }
}

/** Reconstruit l'index des scores (après une restauration). */
export async function rebuildScoreIndex(): Promise<void> {
  await chrome.storage.local.set({ [SCORE_INDEX_KEY]: buildScoreIndex(await getAllItems()) });
}
