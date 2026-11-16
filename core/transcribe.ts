import { GEMINI_MODELS, geminiGenerate } from './gemini';
import { parseTimestamp } from './schema';
import type { FetchFn, Segment } from './types';
import { formatTime } from './youtube';

// Gemini lit lui-même la vidéo YouTube à partir de son URL : rien à télécharger,
// ce qui contourne le blocage des flux audio par YouTube (lite-latest : horodatages à ±5 s).
export const GEMINI_TRANSCRIBE_MODELS = GEMINI_MODELS;

export interface TranscribeOptions {
  key: string | string[];
  models?: string[];
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export function buildTranscribePrompt(durationS: number): string {
  const duration = formatTime(durationS);
  return `Transcris intégralement et fidèlement la parole de cette vidéo, dans sa langue d'origine, sans résumer ni reformuler.
La vidéo dure exactement ${duration} : chaque horodatage doit correspondre au temps réel de lecture (de 0:00 à ${duration}).
Format :
- première ligne : « LANGUE: xx » avec le code ISO 639-1 de la langue parlée ;
- puis une ligne par phrase ou groupe de mots de 3 à 8 secondes (comme des sous-titres), commençant par l'horodatage de début entre crochets au format m:ss (ou h:mm:ss), par exemple « [1:05] texte ».
Aucun autre texte.`;
}

const LINE_RE = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;

/** Lignes « [m:ss] texte » → segments triés, bornés à la durée ; ignore tout le reste. */
export function parseTimedLines(text: string, durationS: number): { language: string; segments: Segment[] } {
  const language = text.match(/LANGUE\s*:\s*([a-z]{2})/i)?.[1].toLowerCase() ?? 'fr';
  const segments: Segment[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(LINE_RE);
    if (!m || !m[2].trim()) continue;
    segments.push({ start: Math.min(parseTimestamp(m[1]), durationS), text: m[2].trim() });
  }
  segments.sort((a, b) => a.start - b.start);
  return { language, segments };
}

export async function transcribeYouTube(
  video: { videoId: string; durationS: number },
  opts: TranscribeOptions,
): Promise<{ language: string; segments: Segment[]; model: string }> {
  const { text, model } = await geminiGenerate(
    [
      // Une image toutes les 10 s suffit : seule la parole compte, et cela divise le coût en tokens.
      { fileData: { fileUri: `https://www.youtube.com/watch?v=${video.videoId}` }, videoMetadata: { fps: 0.1 } },
      { text: buildTranscribePrompt(video.durationS) },
    ],
    {
      ...opts,
      generationConfig: { mediaResolution: 'MEDIA_RESOLUTION_LOW' },
      badRequestMessage: 'Gemini ne peut pas lire cette vidéo (privée, non répertoriée ou trop longue).',
      failurePrefix: 'Transcription audio impossible',
    },
    (t) => parseTimedLines(t, video.durationS).segments.length > 0,
  );
  return { ...parseTimedLines(text, video.durationS), model };
}
