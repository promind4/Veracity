// Banc de calibration : analyse les vidéos de référence (rapports mis en cache dans out/calib/)
// puis recalcule les scores avec core/score.ts et les compare aux fourchettes attendues.
// npm run calibrate                 → analyse ce qui manque (1 passage par vidéo) puis compare
// npm run calibrate -- --runs 2     → 2 passages par vidéo (mesure la stabilité)
// npm run calibrate -- --offline    → recalcule seulement, sans appel LLM (pour régler score.ts)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { analyzeVideo } from '../core/pipeline';
import { computeScores } from '../core/score';
import { transcribeYouTube } from '../core/transcribe';
import { type Config, DEFAULT_MODELS, type Report, type VideoInput } from '../core/types';
import { fetchVideo } from '../core/youtube';

interface Reference {
  id: string;
  note: string;
  facts?: [number, number];
  discourse?: [number, number];
  labels?: string[];
}

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
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

const corpus: Reference[] = JSON.parse(readFileSync('calibration/corpus.json', 'utf8'));
const dir = 'out/calib';
mkdirSync(dir, { recursive: true });
const runsIndex = process.argv.indexOf('--runs');
const runs = runsIndex > 0 ? Number(process.argv[runsIndex + 1]) : 1;
const offline = process.argv.includes('--offline');

const cached = (id: string) => readdirSync(dir).filter((f) => /^[\w-]{11}\.\d+\.json$/.test(f) && f.startsWith(`${id}.`));

/** Transcription mise en cache : YouTube limite vite les sous-titres ; Gemini prend le relais si besoin. */
async function loadVideo(id: string): Promise<VideoInput> {
  const path = `${dir}/${id}.video.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const key = config.geminiKey;
  const fallback = key ? (v: { videoId: string; durationS: number }) => transcribeYouTube(v, { key }) : undefined;
  const video = await fetchVideo(id, fetch, 'fr', fallback);
  writeFileSync(path, JSON.stringify(video));
  return video;
}

if (!offline) {
  for (const ref of corpus) {
    for (let run = cached(ref.id).length; run < runs; run++) {
      const started = Date.now();
      console.error(`… ${ref.id} passage ${run + 1}/${runs}`);
      try {
        const video = await loadVideo(ref.id);
        const report = await analyzeVideo(video, config, (step, detail) => console.error(`   ${step} ${detail ?? ''}`));
        writeFileSync(`${dir}/${ref.id}.${run + 1}.json`, JSON.stringify(report, null, 2));
        console.error(`   ✓ ${Math.round((Date.now() - started) / 1000)} s`);
      } catch (e) {
        console.error(`   ✗ ${(e as Error).message}`);
        break;
      }
    }
  }
}

const inRange = (v: number | null, r?: [number, number]) => !r || (v !== null && v >= r[0] && v <= r[1]);
const fmt = (v: number | null) => (v === null ? ' —' : String(v).padStart(3));
let passed = 0;
let total = 0;
for (const ref of corpus) {
  console.log(`\n${ref.id} · ${ref.note}`);
  console.log(`   attendu : faits ${ref.facts?.join('–') ?? 'libre'} · discours ${ref.discourse?.join('–') ?? 'libre'}`);
  for (const file of cached(ref.id)) {
    const r: Report = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    // Le rapport garde l'écart entre passages et la fiabilité (calculés à l'analyse) ; le reste est recalculé avec le barème actuel.
    const s = { ...computeScores(r.claims, r.verdicts, r.rhetoric), range: r.scores.range, reliability: r.scores.reliability };
    const ok = inRange(s.facts, ref.facts) && inRange(s.discourse, ref.discourse) && (!ref.labels || ref.labels.includes(s.label));
    total++;
    if (ok) passed++;
    const verdicts = r.verdicts.map((v) => v.verdict).reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
    const rhetoric = r.rhetoric.map((x) => x.technique).join(', ') || 'aucune';
    console.log(`   ${ok ? '✅' : '❌'} ${file.padEnd(20)} faits ${fmt(s.facts)} · discours ${fmt(s.discourse)} · couverture ${Math.round(s.coverage * 100)} % · ${s.label} · fiabilité ${s.reliability ?? '—'}${s.range ? ` (passages ${s.range[0]}–${s.range[1]})` : ''}`);
    console.log(`      verdicts ${JSON.stringify(verdicts)} · rhétorique : ${rhetoric}`);
  }
}
console.log(`\n${passed}/${total} rapports dans les fourchettes attendues.`);
