// Compare les moteurs d'analyse sur les 5 vidéos de référence (transcriptions et preuves déjà en cache) :
//  - vérification : mêmes affirmations et mêmes preuves pour tous → on compare les verdicts et le score des faits ;
//  - extraction : même transcription → on compare le nombre d'affirmations, les procédés relevés et les scores.
// npx tsx calibration/compare-models.ts [--only gemini|nvidia]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type JsonEngine, geminiEngine, openrouterEngine } from '../core/engine';
import { extractClaims } from '../core/extract';
import { computeScores } from '../core/score';
import type { Report, VideoInput } from '../core/types';
import { verifyClaims } from '../core/verify';
import { formatTranscript } from '../core/youtube';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const ids = ['Iun1QLA43xE', 'y0opgc1WoS4', 'Flrj38PSz8w', 'bvQ3deqSPnQ', 'qjk6DYHZyuc'];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';

const engines: Record<string, JsonEngine> = {};
const modelsArg = process.argv.includes('--models') ? process.argv[process.argv.indexOf('--models') + 1].split(',') : null;
if (only !== 'nvidia') {
  for (const m of modelsArg ?? ['gemini-flash-lite-latest', 'gemini-3-flash-preview', 'gemini-flash-latest']) engines[m] = geminiEngine({ key: [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean), models: [m], attempts: 2 });
}
if (only !== 'gemini' && !modelsArg) {
  engines['nvidia-ultra-550b'] = openrouterEngine({ key: env.OPENROUTER_API_KEY, models: ['nvidia/nemotron-3-ultra-550b-a55b:free'] });
}

const dir = 'out/compare';
mkdirSync(dir, { recursive: true });
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

async function run(name: string, engine: JsonEngine) {
  const rows: string[] = [];
  for (const id of ids) {
    const video: VideoInput = load(`out/calib/${id}.video.json`);
    const base: Report = load(`out/calib-v1/${id}.1.json`);
    const row: Record<string, string | number> = { id };
    const cache = `${dir}/${name}.${id}.json`;
    let saved: { extract?: unknown; verify?: unknown; extractMs?: number; verifyMs?: number } = existsSync(cache) ? load(cache) : {};
    try {
      if (!saved.verify) {
        const t0 = Date.now();
        const out = await verifyClaims(video, base.claims, base.evidence, engine);
        saved = { ...saved, verify: out.verdicts, verifyMs: Date.now() - t0 };
      }
      if (!saved.extract) {
        const t0 = Date.now();
        const out = await extractClaims(video, formatTranscript(video.segments).text, engine, []);
        saved = { ...saved, extract: out.extraction, extractMs: Date.now() - t0 };
      }
    } catch (e) {
      row.error = (e as Error).message.slice(0, 120);
    }
    writeFileSync(cache, JSON.stringify(saved, null, 1));
    if (saved.verify) {
      const verdicts = saved.verify as Report['verdicts'];
      const s = computeScores(base.claims, verdicts, base.rhetoric);
      row.verifFaits = s.facts ?? '—';
      row.verifS = Math.round((saved.verifyMs ?? 0) / 1000);
      row.verdicts = verdicts.map((v) => v.verdict[0] + (v.verdict === 'plutot_vrai' ? 'v' : '')).join('');
    }
    if (saved.extract) {
      const x = saved.extract as Report['claims'] extends never ? never : { claims: Report['claims']; rhetoric: Report['rhetoric'] };
      const s = computeScores(x.claims, [], x.rhetoric);
      row.affirm = x.claims.length;
      row.proced = x.rhetoric.length;
      row.discours = s.discourse;
      row.extractS = Math.round((saved.extractMs ?? 0) / 1000);
    }
    rows.push(JSON.stringify(row));
    console.error(`${name} ${id} ok`);
  }
  return rows;
}

const results: (readonly [string, string[]])[] = [];
for (const [name, engine] of Object.entries(engines)) results.push([name, await run(name, engine)] as const);
for (const [name, rows] of results) {
  console.log(`\n=== ${name}`);
  for (const r of rows) console.log(r);
}
