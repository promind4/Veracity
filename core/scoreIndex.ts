// Index compact des scores déjà calculés, lu par le script de la page YouTube (badges) sans charger les rapports entiers.

export interface ScoreEntry {
  facts: number | null;
  discourse: number;
  label: string;
  author: string;
  at: string;
  reliability?: string;
}

export type ScoreIndex = Record<string, ScoreEntry>;

export const SCORE_INDEX_KEY = 'scoreIndex';

interface ReportLike {
  videoId: string;
  author?: string;
  createdAt?: string;
  scores: { facts: number | null; discourse: number; label: string; reliability?: string };
}

export const entryOf = (r: ReportLike): ScoreEntry => ({
  facts: r.scores.facts,
  discourse: r.scores.discourse,
  label: r.scores.label,
  author: r.author ?? '',
  at: r.createdAt ?? '',
  reliability: r.scores.reliability,
});

/** Reconstruit l'index à partir des clés `report:<id>` du stockage. */
export function buildScoreIndex(items: Record<string, unknown>): ScoreIndex {
  const index: ScoreIndex = {};
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith('report:')) continue;
    const r = value as ReportLike | null;
    if (r?.scores && typeof r.videoId === 'string') index[r.videoId] = entryOf(r);
  }
  return index;
}

export type ScoreTone = 'ok' | 'warn' | 'bad' | 'na';
export const toneOf = (n: number | null): ScoreTone => (n === null ? 'na' : n >= 75 ? 'ok' : n >= 50 ? 'warn' : 'bad');

/** Texte et couleur du badge : le score des faits en premier, le discours dans l'infobulle (ou à côté sur la page de la vidéo). */
export function chipOf(e: ScoreEntry): { text: string; tone: ScoreTone; title: string } {
  return {
    text: e.facts === null ? 'Non évaluable' : `Faits ${e.facts} %`,
    tone: toneOf(e.facts),
    title: `Veracity — ${e.label} (faits ${e.facts ?? '—'} %, discours ${e.discourse} %${e.reliability ? `, fiabilité de la note : ${e.reliability}` : ''})`,
  };
}
