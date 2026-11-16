// Mesure la stabilité des notes : même moteur, mêmes données, plusieurs passages.
//  - vérification : mêmes affirmations et mêmes preuves, N passages (température 0 puis 0,4) → écart des scores des faits ;
//  - extraction : même transcription, N passages → écart du nombre d'affirmations et des procédés relevés.
// npx tsx calibration/stability.ts [N]
import { readFileSync } from 'node:fs';
import { geminiEngine } from '../core/engine';
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
const N = Number(process.argv[2] ?? 3);
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['y0opgc1WoS4', 'bvQ3deqSPnQ'];
const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const models = ['gemini-3-flash-preview'];
const spread = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)} (écart ${Math.max(...xs) - Math.min(...xs)})` : '—');

for (const id of ids) {
  const video: VideoInput = load(`out/calib/${id}.video.json`);
  const base: Report = load(`out/calib-v1/${id}.1.json`);
  console.log(`\n=== ${id} ${video.title.slice(0, 50)}`);
  for (const temperature of [0, 0.4]) {
    const engine = geminiEngine({ key: [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean), models, temperature });
    const scores: number[] = [];
    const verdictSets: string[] = [];
    for (let i = 0; i < N; i++) {
      try {
        const out = await verifyClaims(video, base.claims, base.evidence, engine);
        const s = computeScores(base.claims, out.verdicts, base.rhetoric).facts;
        if (s !== null) scores.push(s);
        verdictSets.push(out.verdicts.map((v) => v.verdict[0]).join(''));
      } catch (e) {
        console.log(`   verif erreur : ${(e as Error).message.slice(0, 80)}`);
      }
    }
    console.log(`verification T=${temperature} : faits ${spread(scores)}  verdicts ${verdictSets.join(' | ')}`);
  }
  const engine = geminiEngine({ key: [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean), models, temperature: 0 });
  const counts: string[] = [];
  const discourse: number[] = [];
  for (let i = 0; i < N; i++) {
    try {
      const { extraction } = await extractClaims(video, formatTranscript(video.segments).text, engine, []);
      counts.push(`${extraction.claims.filter((c) => c.type !== 'opinion').length}f/${extraction.rhetoric.length}p`);
      discourse.push(computeScores(extraction.claims, [], extraction.rhetoric).discourse);
    } catch (e) {
      console.log(`   extraction erreur : ${(e as Error).message.slice(0, 80)}`);
    }
  }
  console.log(`extraction T=0 : affirmations/procédés ${counts.join(' ')} · discours ${spread(discourse)}`);
}
