// Questions à choix multiple pour réviser les termes du lexique, générées par l'IA puis gardées sur chaque terme.

import { z } from 'zod';
import { analysisEngine } from './engine';
import type { LexiconTerm, Quiz } from './lexicon';
import type { Config, FetchFn } from './types';

export const QUIZ_BATCH = 10;

const profileLine = (profile?: string) => (profile?.trim() ? profile.trim().slice(0, 1500) : 'non renseigné : suppose un débutant curieux.');

export function buildQuizPrompt(terms: LexiconTerm[], profile?: string): string {
  const list = terms.map((t) => `- id « ${t.id} » : ${t.term}${t.full ? ` (${t.full})` : ''} — ${t.definition}`).join('\n');
  return `Tu prépares des questions de révision à choix multiple (QCM) pour un utilisateur qui apprend du vocabulaire.

Profil de l'utilisateur : ${profileLine(profile)}

Pour CHAQUE terme ci-dessous, écris une question qui vérifie qu'il a compris le sens du terme (pas seulement son nom) :
- "question" : une question courte et concrète (par exemple une mise en situation : « Tu veux relier un capteur à ton application : quel rôle joue le broker ? »).
- "choices" : exactement 4 propositions plausibles, courtes, dont UNE seule est correcte. Les mauvaises réponses doivent être crédibles (confusions classiques, termes voisins), jamais absurdes ni évidentes.
- "answer" : l'indice (0 à 3) de la bonne proposition.
- "explanation" : 1 ou 2 phrases qui expliquent pourquoi la bonne réponse est juste et ce qui distingue les autres.
Appuie-toi uniquement sur la définition fournie ; ne pose pas de question dont la réponse n'est pas dans cette définition.

Termes :
${list}

Réponds UNIQUEMENT avec ce JSON :
{"quizzes":[{"id":"...","question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."}]}`;
}

const Item = z.object({
  id: z.string(),
  question: z.string().trim().min(5),
  choices: z.array(z.string().trim().min(1)).length(4),
  answer: z.coerce.number().int().min(0).max(3),
  explanation: z.string().trim().catch(''),
});

/** Mélange les propositions (le modèle met trop souvent la bonne réponse en premier) en gardant l'indice juste. */
export function shuffleQuiz(quiz: Quiz, random: () => number = Math.random): Quiz {
  const order = quiz.choices.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...quiz, choices: order.map((i) => quiz.choices[i]), answer: order.indexOf(quiz.answer) };
}

/** Garde les questions valides (4 propositions distinctes) pour les identifiants demandés. */
export function parseQuizzes(raw: unknown, ids: string[], random: () => number = Math.random): Record<string, Quiz> {
  const out: Record<string, Quiz> = {};
  for (const entry of Array.isArray(raw) ? raw : []) {
    const parsed = Item.safeParse(entry);
    if (!parsed.success || !ids.includes(parsed.data.id)) continue;
    const { id, ...quiz } = parsed.data;
    if (new Set(quiz.choices.map((c) => c.toLowerCase())).size < 4) continue;
    out[id] = shuffleQuiz(quiz, random);
  }
  return out;
}

/** Une requête pour un lot de termes ; ceux dont la question est inexploitable sont simplement absents du résultat. */
export async function generateQuizzes(
  terms: LexiconTerm[],
  profile: string | undefined,
  config: Pick<Config, 'geminiKey' | 'geminiKey2' | 'openrouterKey' | 'models'>,
  fetchFn?: FetchFn,
): Promise<Record<string, Quiz>> {
  const batch = terms.slice(0, QUIZ_BATCH);
  if (!batch.length) return {};
  const engine = analysisEngine(config, fetchFn);
  const { data } = await engine([{ role: 'user', content: buildQuizPrompt(batch, profile) }], z.object({ quizzes: z.array(z.unknown()) }));
  return parseQuizzes(data.quizzes, batch.map((t) => t.id));
}
