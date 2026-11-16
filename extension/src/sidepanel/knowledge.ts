import { categorizeVideo } from '../../../core/categorize';
import { analysisEngine } from '../../../core/engine';
import { chatToMarkdown, kbDocument, reportToMarkdown, transcriptToMarkdown, translationToMarkdown } from '../../../core/export';
import { BACKUP_VERSION, buildVideoBackup, type LexiconBackup, mergeChannels, mergeLexicons, restorePlan, tutorChatToMarkdown, VIDEO_DATA_FILE } from '../../../core/backup';
import { type ChannelReport, channelToMarkdown } from '../../../core/channel';
import type { ChatTurn } from '../../../core/chat';
import { type Lexicon, lexiconToMarkdown } from '../../../core/lexicon';
import { slugify } from '../../../core/export';
import { sanitizeName } from '../../../core/kb';
import { type KbKind, normalizeCategory, type VideoMeta, videoFolderName } from '../../../core/kb';
import { type Report, type VideoInput } from '../../../core/types';
import { findVideoCategory, getKbRoot, kbAccess, listCategories, moveVideoFolder, readBackups, requestKbAccess, updateKbIndex, writeChannelFiles, writeLexiconFiles, writeVideoFiles } from '../shared/kb';
import { collectVideoItems, getCachedReport, getChat, getLexicon, getTranslation, getVideoMeta, listChannels, loadConfig, rebuildChannelIndex, rebuildScoreIndex, saveChannel, saveLexicon, saveVideoMeta } from '../shared/storage';

export type SaveResult = { saved: true; path: string } | { saved: false; reason: 'none' | 'denied' };

/** Racine accessible : `interactive` autorise la demande de permission (geste utilisateur requis). */
async function accessibleRoot(interactive: boolean): Promise<FileSystemDirectoryHandle | 'none' | 'denied'> {
  const root = await getKbRoot();
  if (!root) return 'none';
  let access = await kbAccess(root);
  if (access === 'prompt' && interactive) access = (await requestKbAccess(root)) ? 'granted' : 'prompt';
  return access === 'granted' ? root : 'denied';
}

export async function grantedCategories(): Promise<string[]> {
  const root = await accessibleRoot(false);
  return typeof root === 'string' ? [] : listCategories(root);
}

const metaInFlight = new Map<string, Promise<VideoMeta>>();

/**
 * Catégorie de la vidéo. Plusieurs enregistrements automatiques partent parfois en même temps (analyse, traduction,
 * discussion) : ils partagent la même résolution, sinon chacun obtiendrait sa propre catégorie et la vidéo serait
 * enregistrée en double.
 */
function resolveMeta(video: VideoInput, report: Report | null, root: FileSystemDirectoryHandle): Promise<VideoMeta> {
  let pending = metaInFlight.get(video.videoId);
  if (!pending) {
    pending = computeMeta(video, report, root).finally(() => metaInFlight.delete(video.videoId));
    metaInFlight.set(video.videoId, pending);
  }
  return pending;
}

/** Le dossier déjà présent sur le disque fait foi ; sinon catégorie connue, issue du rapport, ou demandée au LLM (1 requête). */
async function computeMeta(video: VideoInput, report: Report | null, root: FileSystemDirectoryHandle): Promise<VideoMeta> {
  const [known, onDisk] = await Promise.all([getVideoMeta(video.videoId), findVideoCategory(root, video.videoId)]);
  if (onDisk && onDisk !== known?.category) {
    const meta = { category: onDisk, tags: known?.tags ?? report?.tags ?? [] };
    await saveVideoMeta(video.videoId, meta);
    return meta;
  }
  if (known) return known;
  const categories = await listCategories(root);
  let meta: VideoMeta;
  if (report?.category) {
    meta = { category: normalizeCategory(report.category, categories), tags: report.tags ?? [] };
  } else {
    const config = await loadConfig();
    const { category, tags } = await categorizeVideo(video, categories, analysisEngine(config));
    meta = { category, tags };
  }
  await saveVideoMeta(video.videoId, meta);
  return meta;
}

/** Écrit les documents demandés (la transcription est toujours incluse) dans <base>/<catégorie>/<vidéo>/. */
export async function saveToKb(video: VideoInput, kinds: KbKind[], interactive: boolean): Promise<SaveResult> {
  const root = await accessibleRoot(interactive);
  if (typeof root === 'string') return { saved: false, reason: root };
  const { targetLang = 'fr' } = await loadConfig();
  const [report, turns, translation] = await Promise.all([
    getCachedReport(video.videoId),
    getChat(video.videoId),
    getTranslation(video.videoId, targetLang),
  ]);
  const meta = await resolveMeta(video, report, root);
  const savedAt = new Date().toISOString().slice(0, 10);
  const doc = (kind: KbKind, body: string) => kbDocument(kind, video, meta, body, report, savedAt);
  const files: Partial<Record<KbKind, string>> = { transcript: doc('transcript', transcriptToMarkdown(video)) };
  if (translation) files.translation = doc('translation', translationToMarkdown(video, translation));
  if (kinds.includes('report') && report) files.report = doc('report', reportToMarkdown(report));
  if (kinds.includes('chat') && turns.some((t) => !t.error)) files.chat = doc('chat', chatToMarkdown(video, turns));
  const folder = videoFolderName(video.title, video.videoId);
  const backup = buildVideoBackup(video.videoId, { ...(await collectVideoItems(video.videoId)), [`meta:${video.videoId}`]: meta }, new Date().toISOString());
  await writeVideoFiles(root, meta.category, folder, files, { [VIDEO_DATA_FILE]: JSON.stringify(backup) });
  await refreshIndex(root);
  return { saved: true, path: `${root.name}\\${meta.category}\\${folder}` };
}

/** Change la catégorie et déplace le dossier déjà enregistré ; renvoie le nom retenu. */
export async function changeCategory(video: VideoInput, input: string): Promise<string> {
  const root = await accessibleRoot(true);
  const granted = typeof root !== 'string';
  const next = normalizeCategory(input, granted ? await listCategories(root) : []);
  const previous = await getVideoMeta(video.videoId);
  const from = granted ? ((await findVideoCategory(root, video.videoId)) ?? previous?.category) : undefined;
  if (granted && from) {
    await moveVideoFolder(root, from, next, videoFolderName(video.title, video.videoId));
    await refreshIndex(root);
  }
  const tags = previous?.tags ?? (await getCachedReport(video.videoId))?.tags ?? [];
  await saveVideoMeta(video.videoId, { category: next, tags });
  return next;
}

/** INDEX.md à la racine de la base ; un échec n'empêche pas l'enregistrement lui-même. */
async function refreshIndex(root: FileSystemDirectoryHandle): Promise<void> {
  try {
    await updateKbIndex(root);
  } catch (e) {
    console.warn('Index de la base non mis à jour', e);
  }
}

/** Reconstruit INDEX.md à la demande ; renvoie le nombre de vidéos indexées, ou la raison de l'échec. */
export async function rebuildKbIndex(): Promise<number | 'none' | 'denied'> {
  const root = await accessibleRoot(true);
  if (typeof root === 'string') return root;
  return updateKbIndex(root);
}

/** Discussions d'apprentissage de tous les termes, par identifiant de terme. */
async function allTutorChats(lexicon: Lexicon): Promise<Record<string, ChatTurn[]>> {
  const stored = await chrome.storage.local.get(Object.keys(lexicon).map((id) => `lexchat:${id}`));
  return Object.fromEntries(Object.entries(lexicon).flatMap(([id]) => (stored[`lexchat:${id}`] ? [[id, stored[`lexchat:${id}`] as ChatTurn[]]] : [])));
}

/**
 * Sauvegarde le lexique dans `<base>/_Lexique/` : données restaurables, LEXIQUE.md lisible et une discussion par terme.
 * `interactive` autorise la demande de permission (geste de l'utilisateur).
 */
export async function backupLexicon(lexicon: Lexicon, interactive: boolean): Promise<'saved' | 'none' | 'denied'> {
  const root = await accessibleRoot(interactive);
  if (typeof root === 'string') return root;
  const savedAt = new Date().toISOString();
  const chats = await allTutorChats(lexicon);
  const data: LexiconBackup = { version: BACKUP_VERSION, savedAt, lexicon, chats };
  await writeLexiconFiles(root, {
    data: JSON.stringify(data),
    doc: lexiconToMarkdown(lexicon, savedAt.slice(0, 10)),
    chats: Object.fromEntries(Object.entries(chats).filter(([id, turns]) => lexicon[id] && turns.some((t) => !t.error)).map(([id, turns]) => [slugify(lexicon[id].term) || id, tutorChatToMarkdown(lexicon[id], turns)])),
  });
  return 'saved';
}

export interface RestoreResult {
  videos: number;
  terms: number;
  channels: number;
}

/** Réimporte dans l'extension ce que la base contient (vidéos et lexique), sans écraser du plus récent. */
export async function restoreFromKb(): Promise<RestoreResult | 'none' | 'denied'> {
  const root = await accessibleRoot(true);
  if (typeof root === 'string') return root;
  const { videos, lexicon, channels } = await readBackups(root);
  let restored = 0;
  for (const backup of videos) {
    const plan = restorePlan(backup, await collectVideoItems(backup.videoId));
    if (Object.keys(plan).length) {
      await chrome.storage.local.set(plan);
      restored++;
    }
  }
  await rebuildScoreIndex();
  let terms = 0;
  if (lexicon) {
    const local = await getLexicon();
    const merged = mergeLexicons(local, lexicon.lexicon);
    terms = Object.keys(merged).length - Object.keys(local).length;
    await saveLexicon(merged);
    const localChats = await allTutorChats(merged);
    const plan: Record<string, ChatTurn[]> = {};
    for (const [id, turns] of Object.entries(lexicon.chats)) if (merged[id] && turns.length > (localChats[id]?.length ?? 0)) plan[`lexchat:${id}`] = turns;
    if (Object.keys(plan).length) await chrome.storage.local.set(plan);
  }
  const localChannels = await listChannels();
  const mergedChannels = mergeChannels(localChannels, channels);
  const changed = mergedChannels.filter((c) => localChannels.find((l) => l.channelId === c.channelId)?.createdAt !== c.createdAt);
  for (const c of changed) await saveChannel(c);
  await rebuildChannelIndex();
  return { videos: restored, terms, channels: changed.length };
}

/** Écrit l'analyse d'une chaîne dans `<base>/_Chaînes/<nom [id]>/` ; renvoie le chemin, ou la raison de l'échec. */
export async function backupChannel(report: ChannelReport, interactive: boolean): Promise<{ path: string } | 'none' | 'denied'> {
  const root = await accessibleRoot(interactive);
  if (typeof root === 'string') return root;
  const folder = `${sanitizeName(report.name, 60) || 'Chaîne'} [${report.channelId}]`;
  await writeChannelFiles(root, folder, channelToMarkdown(report), JSON.stringify(report));
  return { path: [root.name, '_Chaînes', folder].join('\\') };
}
