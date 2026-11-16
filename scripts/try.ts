import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { buildChatMessages } from '../core/chat';
import { chatStream } from '../core/llm';
import { analyzeVideo } from '../core/pipeline';
import { parseTimestamp } from '../core/schema';
import { type Config, DEFAULT_MODELS, type Report, type VideoInput } from '../core/types';
import { buildCues } from '../core/cues';
import { assignVoices, detectSpeakers } from '../core/speakers';
import { transcribeYouTube } from '../core/transcribe';
import { translateCues, translationEngine } from '../core/translate';
import { analyzeChannel, channelToMarkdown, feedUrl, parseFeed } from '../core/channel';
import { fetchVideo, formatTime, parseVideoId } from '../core/youtube';

function loadEnv(path = '.env'): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
    );
  } catch {
    return {};
  }
}

function videoFromTranscriptFile(path: string): VideoInput {
  const segments = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\[(\d+:\d{2}(?::\d{2})?)\]\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ start: parseTimestamp(m[1]), text: m[2] }));
  return { videoId: basename(path).replace(/\.\w+$/, ''), title: basename(path), author: '(fichier local)', description: '', durationS: segments.at(-1)?.start ?? 0, language: 'fr', segments };
}

function printReport(r: Report) {
  const evById = new Map(r.evidence.map((e) => [e.id, e]));
  console.log(`\n=== ${r.scores.label}`);
  console.log(`Faits : ${r.scores.facts ?? '—'} % · Discours : ${r.scores.discourse} % · Couverture : ${Math.round(r.scores.coverage * 100)} % · Modèles : ${r.models.join(', ')}`);
  console.log(`\nRésumé : ${r.summary}\n`);
  for (const c of r.claims) {
    const v = r.verdicts.find((x) => x.claimId === c.id);
    const sources = (v?.evidenceIds ?? []).map((id) => evById.get(id)?.url).filter(Boolean);
    console.log(`[${formatTime(c.timestampS)}] ${c.id} ${(v?.verdict ?? c.type).toUpperCase()} — ${c.claim}`);
    if (v?.explanation) console.log(`    ${v.explanation}`);
    if (sources.length) console.log(`    Sources : ${sources.join(' · ')}`);
  }
  console.log('\nDiscours :');
  for (const x of r.rhetoric) console.log(`  [${formatTime(x.timestampS)}] ${x.technique} — « ${x.quote} »`);
  for (const w of r.warnings) console.log(`⚠️  ${w}`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage : npm run try -- <url ou id YouTube | fichier.txt> [--ask "question"]');
  process.exit(1);
}
const env = loadEnv();
const config: Config = {
  openrouterKey: env.OPENROUTER_API_KEY ?? '',
  serperKey: env.SERPER_API_KEY,
  jinaKey: env.JINA_API_KEY,
  factcheckKey: env.GOOGLE_FACTCHECK_API_KEY,
  scraperapiKey: env.SCRAPERAPI_KEY,
  geminiKey: env.GEMINI_API_KEY,
  geminiKey2: env.GEMINI_API_KEY_2,
  models: env.MODELS ? env.MODELS.split(',') : DEFAULT_MODELS,
};
const started = Date.now();
const videoId = parseVideoId(arg);
const askIndex = process.argv.indexOf('--ask');

async function loadInput(): Promise<VideoInput> {
  if (arg.endsWith('.txt')) return videoFromTranscriptFile(arg);
  if (!videoId) throw new Error(`Identifiant YouTube illisible : ${arg}`);
  const geminiKey = env.GEMINI_API_KEY;
  const fallback = geminiKey ? (v: { videoId: string; durationS: number }) => transcribeYouTube(v, { key: geminiKey }) : undefined;
  if (process.argv.includes('--audio')) {
    // Force la transcription audio (pour tester Gemini sur une vidéo qui a des sous-titres).
    const video = await fetchVideo(videoId);
    if (!fallback) throw new Error('GEMINI_API_KEY manquante dans .env');
    return { ...video, ...(await fallback(video)), transcriptSource: 'gemini' };
  }
  return fetchVideo(videoId, fetch, 'fr', fallback);
}

const translateIndex = process.argv.indexOf('--translate');
const channelIndex = process.argv.indexOf('--channel');

if (channelIndex > 0) {
  // Analyse d'une chaîne : npm run try -- x --channel UC… [--sample 5]
  const channelId = process.argv[channelIndex + 1];
  const sampleArg = process.argv.indexOf('--sample');
  const sample = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 5;
  const report = await analyzeChannel(channelId, sample, {
    fetchFeed: async (id) => parseFeed(await (await fetch(feedUrl(id))).text()),
    cachedReport: async (id) => (existsSync(`out/${id}.json`) ? (JSON.parse(readFileSync(`out/${id}.json`, 'utf8')) as Report) : null),
    analyze: async (entry) => {
      const video = await fetchVideo(entry.videoId, fetch, 'fr').catch((e: Error & { code?: string }) => (e.code === 'no_captions' ? null : Promise.reject(e)));
      if (!video) return { skip: 'pas de sous-titres' };
      if (video.durationS < 180) return { skip: 'vidéo trop courte' };
      const r = await analyzeVideo(video, config, () => {}, fetch, [], { passes: 1 });
      mkdirSync('out', { recursive: true });
      writeFileSync(`out/${r.videoId}.json`, JSON.stringify(r, null, 2));
      return r;
    },
    onProgress: (done, total, detail) => console.error(`… ${done}/${total} ${detail}`),
  });
  mkdirSync('out/channels', { recursive: true });
  writeFileSync(`out/channels/${channelId}.json`, JSON.stringify(report, null, 2));
  console.log(channelToMarkdown(report));
  process.exit(0);
}

if (process.argv.includes('--speakers')) {
  // Identification des intervenants et voix attribuées (Gemini et Piper).
  const video = await loadInput();
  const cues = buildCues(video.segments);
  if (!config.geminiKey) throw new Error('GEMINI_API_KEY manquante dans .env');
  const out = await detectSpeakers(video.videoId, cues, { key: config.geminiKey });
  const gemini = assignVoices(out.speakers, 'gemini', 'fr', 'Kore');
  const piper = assignVoices(out.speakers, 'piper', 'fr', undefined);
  console.log(`${video.title} — ${cues.length} sous-titres, ${out.model}, ${Math.round((Date.now() - started) / 1000)} s\n`);
  for (const s of out.speakers) {
    const count = out.byCue.filter((id) => id === s.id).length;
    console.log(`${s.id} · ${s.gender} · ${s.label || '(sans nom)'} · ${count} sous-titres · Gemini ${gemini[s.id]} · Piper ${piper[s.id]}`);
  }
  console.log('');
  cues.forEach((c, i) => {
    if (i === 0 || out.byCue[i] !== out.byCue[i - 1]) console.log(`[${formatTime(c.start)}] ${out.byCue[i]} : ${c.text.slice(0, 90)}`);
  });
} else if (translateIndex > 0) {
  // Traduction des sous-titres : affiche les premières phrases et des statistiques.
  const lang = process.argv[translateIndex + 1] ?? 'fr';
  const video = await loadInput();
  const cues = buildCues(video.segments);
  console.error(`… ${video.title} (${video.language}, ${cues.length} sous-titres) → ${lang}`);
  const out = await translateCues(cues, lang, video.title, translationEngine(config), {
    onProgress: (d, t) => console.error(`… lot ${d}/${t}`),
  });
  for (const c of out.cues.slice(0, 8)) console.log(`[${formatTime(c.start)}–${formatTime(c.end)}] ${c.text}\n          ${c.orig}`);
  console.log(`\n${out.cues.length} sous-titres, ${out.missing} non traduits, ${out.model}, ${Math.round((Date.now() - started) / 1000)} s`);
} else if (askIndex > 0) {
  // Mode discussion : une question sur la vidéo, réponse diffusée au fil de l'eau.
  const question = process.argv[askIndex + 1] ?? 'Résume la vidéo.';
  const video = await loadInput();
  const reportPath = `out/${video.videoId}.json`;
  const report: Report | null = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
  console.error(`… ${video.title} (${video.segments.length} segments, rapport : ${report ? 'oui' : 'non'})`);
  const { model } = await chatStream({ key: config.openrouterKey, models: config.models }, buildChatMessages(video, report, [], question), (d) =>
    process.stdout.write(d),
  );
  console.log(`\n\n(${model}, ${Math.round((Date.now() - started) / 1000)} s)`);
} else {
  const onProgress = (step: string, detail?: string) => console.error(`… ${step}${detail ? ` ${detail}` : ''}`);
  const report = await analyzeVideo(await loadInput(), config, onProgress);
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/${report.videoId}.json`, JSON.stringify(report, null, 2));
  printReport(report);
  console.log(`\nRapport : out/${report.videoId}.json (${Math.round((Date.now() - started) / 1000)} s)`);
}
