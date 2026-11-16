import { CHANNEL_DATA_FILE, CHANNEL_DOC_FILE, CHANNELS_DIR, LEXICON_CHATS_DIR, LEXICON_DATA_FILE, LEXICON_DIR, LEXICON_DOC_FILE, type LexiconBackup, parseChannelBackup, parseLexiconBackup, parseVideoBackup, VIDEO_DATA_FILE, type VideoBackup } from '../../../core/backup';
import type { ChannelReport } from '../../../core/channel';
import { KB_FILES, type KbKind } from '../../../core/kb';
import { buildKbIndex, type KbVideo, parseFrontMatter } from '../../../core/kbIndex';

// Le dossier choisi par l'utilisateur est mémorisé (IndexedDB) pour être réutilisé
// par la page d'options et le side panel, qui partagent l'origine de l'extension.
const DB_NAME = 'veracity';
const STORE = 'handles';
const ROOT_KEY = 'kb-root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export async function getKbRoot(): Promise<FileSystemDirectoryHandle | null> {
  return (await withStore<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(ROOT_KEY))) ?? null;
}

export async function setKbRoot(root: FileSystemDirectoryHandle): Promise<void> {
  await withStore('readwrite', (s) => s.put(root, ROOT_KEY));
}

/** none : aucun dossier choisi · prompt : accès à réautoriser (geste utilisateur requis) · granted : prêt. */
export type KbAccess = 'none' | 'prompt' | 'granted';

export async function kbAccess(root: FileSystemDirectoryHandle | null): Promise<KbAccess> {
  if (!root) return 'none';
  return (await root.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'granted' : 'prompt';
}

export async function requestKbAccess(root: FileSystemDirectoryHandle): Promise<boolean> {
  return (await root.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function listCategories(root: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, entry] of root.entries()) {
    if (entry.kind === 'directory' && !/^[._]/.test(name)) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Catégorie où la vidéo est déjà enregistrée sur le disque (dossier « … [videoId] »), sinon null. */
export async function findVideoCategory(root: FileSystemDirectoryHandle, videoId: string): Promise<string | null> {
  const suffix = `[${videoId}]`;
  for (const category of await listCategories(root)) {
    for await (const [name, entry] of (await root.getDirectoryHandle(category)).entries()) {
      if (entry.kind === 'directory' && name.endsWith(suffix)) return category;
    }
  }
  return null;
}

export async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeVideoFiles(
  root: FileSystemDirectoryHandle,
  category: string,
  folder: string,
  files: Partial<Record<KbKind, string>>,
  /** Fichiers à nom libre (la sauvegarde `veracity.json`). */
  extra: Record<string, string> = {},
): Promise<void> {
  const dir = await (await root.getDirectoryHandle(category, { create: true })).getDirectoryHandle(folder, { create: true });
  for (const [kind, content] of Object.entries(files) as [KbKind, string | undefined][]) {
    if (content !== undefined) await writeFile(dir, KB_FILES[kind], content);
  }
  for (const [name, content] of Object.entries(extra)) await writeFile(dir, name, content);
}

/** `_Lexique/` : données restaurables, version lisible et une discussion par terme. */
export async function writeLexiconFiles(
  root: FileSystemDirectoryHandle,
  files: { data: string; doc: string; chats: Record<string, string> },
): Promise<void> {
  const dir = await root.getDirectoryHandle(LEXICON_DIR, { create: true });
  await writeFile(dir, LEXICON_DATA_FILE, files.data);
  await writeFile(dir, LEXICON_DOC_FILE, files.doc);
  const chats = await dir.getDirectoryHandle(LEXICON_CHATS_DIR, { create: true });
  for (const [name, content] of Object.entries(files.chats)) await writeFile(chats, `${name}.md`, content);
}

/** `_Chaînes/<nom [id]>/` : compte-rendu lisible et données restaurables d'une chaîne analysée. */
export async function writeChannelFiles(root: FileSystemDirectoryHandle, folder: string, doc: string, data: string): Promise<void> {
  const dir = await (await root.getDirectoryHandle(CHANNELS_DIR, { create: true })).getDirectoryHandle(folder, { create: true });
  await writeFile(dir, CHANNEL_DOC_FILE, doc);
  await writeFile(dir, CHANNEL_DATA_FILE, data);
}

const readJson = async (dir: FileSystemDirectoryHandle, name: string): Promise<unknown> => {
  try {
    return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
  } catch {
    return null;
  }
};

/** Relit toutes les sauvegardes de la base : une par dossier de vidéo, plus celle du lexique. */
export async function readBackups(root: FileSystemDirectoryHandle): Promise<{ videos: VideoBackup[]; lexicon: LexiconBackup | null; channels: ChannelReport[] }> {
  const videos: VideoBackup[] = [];
  for await (const [category, catEntry] of root.entries()) {
    if (catEntry.kind !== 'directory' || /^[._]/.test(category)) continue;
    for await (const [, videoEntry] of (catEntry as FileSystemDirectoryHandle).entries()) {
      if (videoEntry.kind !== 'directory') continue;
      const backup = parseVideoBackup(await readJson(videoEntry as FileSystemDirectoryHandle, VIDEO_DATA_FILE));
      // Le dossier fait foi pour la catégorie : la sauvegarde peut dater d'avant un changement de catégorie.
      if (backup) videos.push({ ...backup, meta: { tags: backup.meta?.tags ?? [], category } });
    }
  }
  let lexicon: LexiconBackup | null = null;
  try {
    lexicon = parseLexiconBackup(await readJson(await root.getDirectoryHandle(LEXICON_DIR), LEXICON_DATA_FILE));
  } catch {
    // pas encore de lexique sauvegardé
  }
  const channels: ChannelReport[] = [];
  try {
    for await (const [, entry] of (await root.getDirectoryHandle(CHANNELS_DIR)).entries()) {
      if (entry.kind !== 'directory') continue;
      const channel = parseChannelBackup(await readJson(entry as FileSystemDirectoryHandle, CHANNEL_DATA_FILE));
      if (channel) channels.push(channel);
    }
  } catch {
    // pas encore de chaîne sauvegardée
  }
  return { videos, lexicon, channels };
}

/** Déplace le dossier d'une vidéo vers une autre catégorie ; supprime l'ancienne catégorie si elle devient vide. */
export async function moveVideoFolder(root: FileSystemDirectoryHandle, from: string, to: string, folder: string): Promise<void> {
  if (from === to) return;
  let parent: FileSystemDirectoryHandle;
  let source: FileSystemDirectoryHandle;
  try {
    parent = await root.getDirectoryHandle(from);
    source = await parent.getDirectoryHandle(folder);
  } catch {
    return; // rien n'a encore été enregistré pour cette vidéo
  }
  const target = await (await root.getDirectoryHandle(to, { create: true })).getDirectoryHandle(folder, { create: true });
  for await (const [name, entry] of source.entries()) {
    if (entry.kind === 'file') await writeFile(target, name, await (await (entry as FileSystemFileHandle).getFile()).text());
  }
  await parent.removeEntry(folder, { recursive: true });
  if ((await parent.keys().next()).done) await root.removeEntry(from);
}

/** Parcourt <base>/<catégorie>/<vidéo>/ et lit l'en-tête de métadonnées de chaque vidéo. */
export async function scanKb(root: FileSystemDirectoryHandle): Promise<KbVideo[]> {
  const videos: KbVideo[] = [];
  for await (const [category, catEntry] of root.entries()) {
    if (catEntry.kind !== 'directory' || /^[._]/.test(category)) continue;
    for await (const [folder, videoEntry] of (catEntry as FileSystemDirectoryHandle).entries()) {
      if (videoEntry.kind !== 'directory') continue;
      const dir = videoEntry as FileSystemDirectoryHandle;
      const files: string[] = [];
      for await (const [name, entry] of dir.entries()) if (entry.kind === 'file' && name.endsWith('.md')) files.push(name);
      const source = ['rapport.md', 'transcription.md', ...files].find((f) => files.includes(f));
      const meta = source ? parseFrontMatter(await (await (await dir.getFileHandle(source)).getFile()).text()) : {};
      videos.push({ category, folder, files, meta });
    }
  }
  return videos;
}

/** Réécrit <base>/INDEX.md (table des matières de toutes les vidéos, par catégorie). */
export async function updateKbIndex(root: FileSystemDirectoryHandle): Promise<number> {
  const videos = await scanKb(root);
  await writeFile(root, 'INDEX.md', buildKbIndex(videos, new Date().toISOString().slice(0, 10)));
  return videos.length;
}
