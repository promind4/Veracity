// Nommage des dossiers et fichiers de la base de connaissances (compatible Windows).
import { topicKey } from './topics';

export const KB_FILES = { report: 'rapport.md', chat: 'discussion.md', transcript: 'transcription.md', translation: 'traduction.md' } as const;
export type KbKind = keyof typeof KB_FILES;

export interface VideoMeta {
  category: string;
  tags: string[];
}

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeName(name: string, max = 80): string {
  return name
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
}

const comparable = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // « Spiritualité & développement » et « Spiritualité et développement » : même catégorie.
    .replace(/\b(?:et|and)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');

/** Rattache une catégorie proposée à une catégorie existante (casse et accents ignorés), sinon la nettoie. */
export function normalizeCategory(name: string, existing: string[]): string {
  const clean = sanitizeName(name, 60);
  if (!comparable(clean)) return 'Non classé';
  const match = existing.find((e) => comparable(e) === comparable(clean))
    ?? existing.find((e) => topicKey(e) === topicKey(clean));
  return match ?? clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function videoFolderName(title: string, videoId: string): string {
  return `${sanitizeName(title, 80) || 'Vidéo'} [${videoId}]`;
}

export const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 5);
