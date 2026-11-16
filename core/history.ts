// Historique des vidéos, reconstitué à partir de ce que l'extension a déjà en cache.

export interface HistoryEntry {
  videoId: string;
  title: string;
  author: string;
  durationS?: number;
  language?: string;
  transcriptSource?: 'captions' | 'gemini';
  /** Dernière activité (visite, analyse, question, traduction), au format ISO. */
  lastActivity: string;
  report?: { label: string; facts: number | null; discourse: number; createdAt: string };
  /** Nombre de questions posées dans la discussion. */
  questions: number;
  translations: string[];
  category?: string;
  tags: string[];
  /** Nombre d'intervenants identifiés pour le doublage. */
  speakers?: number;
}

type Draft = Omit<HistoryEntry, 'title' | 'author' | 'lastActivity'> & { title?: string; author?: string; dates: string[] };

const latest = (dates: string[]) => dates.filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? '';

/** Regroupe les clés `video:`, `report:`, `chat:`, `translation:`, `meta:`, `speakers:` et `visit:` par vidéo. */
export function buildHistory(items: Record<string, unknown>): HistoryEntry[] {
  const byId = new Map<string, Draft>();
  const entry = (id: string) => {
    let e = byId.get(id);
    if (!e) byId.set(id, (e = { videoId: id, questions: 0, translations: [], tags: [], dates: [] }));
    return e;
  };
  for (const [key, value] of Object.entries(items)) {
    const [kind, id, lang] = key.split(':');
    if (!id) continue;
    const v = value as Record<string, unknown>;
    switch (kind) {
      case 'video': {
        const e = entry(id);
        Object.assign(e, { title: v.title, author: v.author, durationS: v.durationS, language: v.language, transcriptSource: v.transcriptSource });
        break;
      }
      case 'report': {
        const e = entry(id);
        const scores = v.scores as { label: string; facts: number | null; discourse: number };
        e.title ??= v.title as string;
        e.author ??= v.author as string;
        e.report = { label: scores.label, facts: scores.facts, discourse: scores.discourse, createdAt: v.createdAt as string };
        e.dates.push(v.createdAt as string);
        break;
      }
      case 'chat': {
        const turns = value as { role: string; at: string }[];
        const e = entry(id);
        e.questions = turns.filter((t) => t.role === 'user').length;
        e.dates.push(...turns.map((t) => t.at));
        break;
      }
      case 'translation':
        entry(id).translations.push(lang);
        entry(id).dates.push(v.createdAt as string);
        break;
      case 'meta':
        Object.assign(entry(id), { category: v.category, tags: v.tags ?? [] });
        break;
      case 'speakers':
        entry(id).speakers = (v.speakers as unknown[]).length;
        break;
      case 'visit':
        entry(id).dates.push(value as string);
        break;
    }
  }
  return [...byId.values()]
    .filter((e) => e.title)
    .map(({ dates, ...e }) => ({ ...e, title: e.title!, author: e.author ?? '', translations: e.translations.sort(), lastActivity: latest(dates) }))
    .sort((a, b) => (Date.parse(b.lastActivity) || 0) - (Date.parse(a.lastActivity) || 0));
}

export interface HistoryFilter {
  query?: string;
  category?: string;
  only?: 'analyzed' | 'chat' | 'translated';
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function filterHistory(entries: HistoryEntry[], f: HistoryFilter): HistoryEntry[] {
  const query = normalize(f.query?.trim() ?? '');
  return entries.filter((e) => {
    if (f.category && e.category !== f.category) return false;
    if (f.only === 'analyzed' && !e.report) return false;
    if (f.only === 'chat' && !e.questions) return false;
    if (f.only === 'translated' && !e.translations.length) return false;
    return !query || normalize([e.title, e.author, e.category ?? '', ...e.tags].join(' ')).includes(query);
  });
}

export function historyCategories(entries: HistoryEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'fr'));
}
