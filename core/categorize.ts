import { z } from 'zod';
import { cleanTags, normalizeCategory, type VideoMeta } from './kb';
import type { JsonEngine } from './engine';
import { categoryInstructions, SYSTEM_PROMPT } from './prompts';
import type { VideoInput } from './types';
import { formatTranscript } from './youtube';

const CategorySchema = z.object({
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

/** Classement seul (1 requête), quand la vidéo n'a pas été analysée. */
export async function categorizeVideo(video: VideoInput, existing: string[], engine: JsonEngine): Promise<VideoMeta & { model: string }> {
  const user = `Classe cette vidéo YouTube.

<titre>${video.title}</titre>
<chaine>${video.author}</chaine>
<description>
${video.description.slice(0, 1500)}
</description>
<extraits_transcription>
${[0, 0.5, 0.9].map((fraction) => {
  const start = Math.floor(video.segments.length * fraction);
  return formatTranscript(video.segments.slice(start), 2600).text;
}).filter((text, index, all) => text && all.indexOf(text) === index).join('\n[…]\n')}
</extraits_transcription>

${categoryInstructions(existing)}

Réponds UNIQUEMENT avec ce JSON : {"category":"...","tags":["..."]}`;
  const { data, model } = await engine(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    CategorySchema,
  );
  return { category: normalizeCategory(data.category, existing), tags: cleanTags(data.tags), model };
}
