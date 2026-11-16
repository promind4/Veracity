import { gatherEvidence } from './evidence/gather';
import { extractClaims } from './extract';
import { analysisEngine } from './engine';
import { computeScores } from './score';
import { type Config, type FetchFn, type OnProgress, type Report, type VideoInput } from './types';
import { verifyClaims } from './verify';
import { fetchVideo, formatTranscript } from './youtube';

/** `categories` : catégories déjà présentes dans la base, pour que le classement les réutilise. */
export async function analyzeVideo(
  video: VideoInput,
  config: Config,
  onProgress: OnProgress = () => {},
  fetchFn: FetchFn = fetch,
  categories: string[] = [],
  opts: { passes?: number } = {},
): Promise<Report> {
  const engine = analysisEngine(config, fetchFn);
  const warnings: string[] = [];

  const { text, truncated } = formatTranscript(video.segments);
  if (truncated) warnings.push('Transcription très longue : seule la première partie a été analysée.');
  if (video.transcriptSource === 'gemini') warnings.push('Pas de sous-titres : transcription audio générée par IA (Gemini), horodatages approximatifs.');

  onProgress('extract');
  const { extraction, model: extractModel } = await extractClaims(video, text, engine, categories);

  const checkableCount = extraction.claims.filter((c) => c.type !== 'opinion').length;
  onProgress('search', `0/${checkableCount}`);
  const { evidence, warnings: searchWarnings } = await gatherEvidence(extraction.claims, config, video.language, {
    fetchFn,
    onClaimDone: (done, total) => onProgress('search', `${done}/${total}`),
  });
  warnings.push(...searchWarnings);

  onProgress('verify');
  // Deux passages indépendants quand Gemini est disponible : leur accord mesure la solidité de la note (3 requêtes au total).
  const passes = opts.passes ?? (config.geminiKey ? 2 : 1);
  const { verdicts, model: verifyModel, passes: passVerdicts, failedPasses } = await verifyClaims(video, extraction.claims, evidence, engine, { passes });
  if (failedPasses) warnings.push('Un des passages de vérification a échoué : la fiabilité de la note est moins bien mesurée.');

  const scores = computeScores(extraction.claims, verdicts, extraction.rhetoric, passVerdicts);
  onProgress('done');
  return {
    version: 1,
    videoId: video.videoId,
    title: video.title,
    author: video.author,
    createdAt: new Date().toISOString(),
    models: [...new Set([extractModel, verifyModel].filter(Boolean))],
    modelsByStage: { extraction: extractModel, verification: verifyModel },
    summary: extraction.summary,
    category: extraction.category || undefined,
    tags: extraction.tags,
    claims: extraction.claims,
    verdicts,
    evidence,
    rhetoric: extraction.rhetoric,
    scores,
    warnings,
  };
}

export async function analyze(videoId: string, config: Config, onProgress: OnProgress = () => {}, fetchFn: FetchFn = fetch): Promise<Report> {
  onProgress('transcript');
  const video = await fetchVideo(videoId, fetchFn);
  return analyzeVideo(video, config, onProgress, fetchFn);
}
