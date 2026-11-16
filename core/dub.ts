import type { Cue } from './cues';

/** Sous-titre à doubler, éventuellement attribué à un intervenant (S1, S2…). */
export interface DubCue extends Cue {
  speaker?: string;
}

/** Passage à synthétiser : une ou plusieurs phrases consécutives, avec la fenêtre de temps disponible. */
export interface DubGroup extends DubCue {
  /** Secondes disponibles avant le groupe suivant (ou jusqu'à la fin du groupe pour le dernier). */
  window: number;
}

// Au-delà de ce silence entre deux phrases, on ne les fait pas lire d'une traite.
const MAX_GAP_S = 1.5;

/**
 * `maxS = 0` : une phrase par groupe (synchronisation la plus fine, pour Piper et le navigateur).
 * `maxS > 0` : phrases regroupées jusqu'à `maxS` secondes (moins de requêtes, pour Gemini).
 * Deux intervenants différents ne sont jamais regroupés (chacun a sa voix).
 */
export function planDubGroups(cues: DubCue[], maxS: number): DubGroup[] {
  const groups: DubCue[] = [];
  for (const cue of cues) {
    const last = groups.at(-1);
    if (last && maxS > 0 && cue.speaker === last.speaker && cue.end - last.start <= maxS && cue.start - last.end <= MAX_GAP_S) {
      last.end = cue.end;
      last.text += ' ' + cue.text;
    } else {
      groups.push({ ...cue });
    }
  }
  return groups.map((g, i) => ({ ...g, window: (groups[i + 1]?.start ?? g.end) - g.start }));
}

/** Vitesse de lecture pour faire tenir `audioS` dans `windowS` : jamais plus lent, au plus ×`max`. */
export function fitRate(audioS: number, windowS: number, max = 1.6): number {
  if (windowS <= 0) return max;
  return Math.round(Math.min(max, Math.max(1, audioS / windowS)) * 100) / 100;
}
