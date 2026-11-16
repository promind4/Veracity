import type { Segment } from './types';

/** Sous-titre court (2 à 7 s), unité de traduction, d'affichage et plus tard de doublage. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const SENTENCE_END = /[.!?…]["»”')]*$/;
// Un sous-titre ne reste pas affiché pendant un long silence.
const MAX_HOLD_S = 6;
const LAST_CUE_S = 4;

export function buildCues(segments: Segment[], maxS = 7, maxChars = 160): Cue[] {
  const cues: Cue[] = [];
  let start = 0;
  let lastStart = 0;
  let parts: string[] = [];
  let length = 0;
  const flush = (nextStart: number | undefined) => {
    if (!parts.length) return;
    const end = nextStart === undefined ? lastStart + LAST_CUE_S : Math.min(nextStart, lastStart + MAX_HOLD_S);
    cues.push({ start, end, text: parts.join(' ') });
    parts = [];
    length = 0;
  };
  segments.forEach((seg, i) => {
    // « >> » marque un changement d'intervenant dans les sous-titres YouTube : on coupe, et on ne le lit pas.
    const newSpeaker = /^\s*>>/.test(seg.text);
    const text = seg.text.replace(/^\s*>>\s*/, '');
    if (parts.length && (newSpeaker || seg.start - start >= maxS || length + text.length > maxChars)) flush(seg.start);
    if (!text) return;
    if (!parts.length) start = seg.start;
    parts.push(text);
    length += text.length + 1;
    lastStart = seg.start;
    if (SENTENCE_END.test(text)) flush(segments[i + 1]?.start);
  });
  flush(undefined);
  return cues;
}

/** Sous-titre affiché à l'instant `t` (recherche dichotomique ; `cues` triés par début). */
export function cueAt(cues: Cue[], t: number): Cue | undefined {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && t < cues[found].end ? cues[found] : undefined;
}
