import { z } from 'zod';
import { cleanTags, normalizeCategory } from './kb';
import type { JsonEngine } from './engine';
import type { ChatMessage } from './llm';
import { categoryInstructions, SYSTEM_PROMPT } from './prompts';
import { enumOf, Timestamp } from './schema';
import { CLAIM_TYPES, type Extraction, TECHNIQUES, type VideoInput } from './types';

export { SYSTEM_PROMPT } from './prompts';

export const MAX_CLAIMS = 15;

const ExtractionSchema = z.object({
  summary: z.string().default(''),
  category: z.string().default(''),
  tags: z.array(z.string()).default([]),
  claims: z
    .array(
      z.object({
        t: Timestamp,
        quote: z.string().default(''),
        claim: z.string().min(3),
        type: enumOf(CLAIM_TYPES, 'fait'),
        importance: z.coerce.number().int().min(1).max(3).catch(2),
        time_sensitive: z.boolean().optional().default(false),
        queries: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  rhetoric: z
    .array(
      z.object({
        t: Timestamp,
        technique: enumOf(TECHNIQUES, 'autre'),
        quote: z.string().default(''),
        explanation: z.string().default(''),
      }),
    )
    .default([]),
});

export function buildExtractionMessages(video: VideoInput, transcript: string, categories: string[] = []): ChatMessage[] {
  const user = `Analyse ${video.platform === 'x' ? 'cette publication X et les sous-titres vidéo disponibles' : 'cette vidéo YouTube'}. Date de l'analyse : ${new Date().toISOString().slice(0, 10)}.
${video.platform === 'x' ? "Le texte de la publication est fourni dans la description. Il peut contenir des affirmations à vérifier : inclus-les même s'il n'y a pas de paroles vidéo. Les paroles éventuelles sont fournies séparément. Distingue strictement la réalité d'un jeu vidéo, d'une fiction, d'une simulation ou d'un jeu de rôle : si le contexte indique un jeu, dis que la personne joue ou que son personnage agit dans le jeu, sans transformer ces événements en faits réels. Les propos d'un personnage ou une narration à la première personne ne sont pas automatiquement des faits sur l'auteur. Si le contexte ne permet pas d'établir ce qui est montré, ne l'invente pas. Ne prétends pas avoir vu ou entendu la vidéo si les sous-titres sont absents. Ne qualifie pas une vidéo de générée par IA sans preuve." : ''}

<titre>${video.title}</titre>
<chaine>${video.author}</chaine>
${video.publishedAt ? `<date_publication>${video.publishedAt}</date_publication>` : ''}
<description>
${video.description.slice(0, 5000)}
</description>
<transcription langue="${video.language}">
${transcript}
</transcription>

Tâches :
1. "summary" : résumé neutre de la vidéo en 3 à 5 phrases.
2. "claims" : au maximum ${MAX_CLAIMS} affirmations, les plus importantes pour juger la fiabilité de la vidéo. Priorité aux affirmations précises et vérifiables : chiffres, dates, statistiques, études citées, lois, faits historiques ou scientifiques, résultats promis.
   - "t" : horodatage en secondes où l'affirmation est prononcée (d'après les repères [m:ss]).
   - "quote" : citation exacte et courte ${video.platform === 'x' ? 'du texte de la publication ou des sous-titres fournis' : 'de la transcription'}.
   - "claim" : reformulation autonome et précise (qui, quoi, quand), compréhensible sans la vidéo, fidèle à ce qui est dit : n'ajoute ni hypothèse ni précision de ton cru (pas de « probablement », pas de nom ou de date que la personne n'a pas donnés). Une prédiction ou une spéculation est une "opinion", pas un "fait".
   - "type" : "fait" (vérifiable objectivement), "promesse_commerciale" (gains, résultats, offres, garanties) ou "opinion" (jugement subjectif).
   - "importance" : 1 (détail ou contexte), 2 (notable) ou 3 (central : la thèse de la vidéo ou un argument qui la soutient). Un fait de contexte (date d'un livre cité, biographie, historique) vaut 1, même s'il est souvent répété.
   - Si la vidéo défend une thèse factuelle (« la Terre est plate », « ce traitement guérit X », « cette crypto va faire x100 »), inclus cette thèse elle-même comme affirmation d'importance 3.
   - "time_sensitive" : true si la vérité de l’affirmation peut changer rapidement (annonce de sortie, lancement, disponibilité, version, prix, loi récente, événement en cours), false pour un fait historique ou stable. Cela déclenche une recherche web renforcée.
   - "queries" : 1 ou 2 requêtes Google courtes, dans la langue la plus pertinente pour trouver des sources fiables. Pour une annonce récente (modèle, produit, étude, réglementation), inclure le nom exact et, si pertinent, son éditeur ou son organisme afin de retrouver l'annonce officielle.
   - N'extrais pas les modalités d'une offre (prix, réduction, places restantes, date limite) : elles relèvent de "rhetoric", pas de "claims".
   - Préfère les affirmations sur le monde (chiffres, lois, études, événements) aux détails de la vie privée de l'auteur, sauf s'ils servent d'argument central (revenus mis en avant pour vendre, par exemple).
3. "rhetoric" : les procédés de persuasion ou de manipulation présents. "technique" parmi :
   urgence (délai artificiel), rarete (stock ou places limitées), generalisation (« tout le monde », « 95 % des gens » sans source), temoignage_inverifiable (succès personnel ou d'élèves invérifiable), promesse_resultat (gain, réussite ou résultat personnel garanti au spectateur ; un appel à l'action collective ou d'intérêt général n'en est pas), autorite_douteuse (expert, étude ou institution citée VAGUEMENT : « des scientifiques disent », « une étude montre » sans la nommer ; un expert nommé avec sa fonction ou son institution n'en est pas un), conflit_interet (l'auteur vend ou touche une commission sur ce que la vidéo recommande sans le signaler clairement : formation, produit, plateforme via lien affilié ou code promo, sponsor non signalé ; un partenariat ou un sponsor explicitement annoncé n'en est pas un), certitude_abusive (prédiction ou spéculation présentée comme certaine ou facile, risques minimisés ou passés sous silence ; annoncer la sortie d'un produit ou d'un modèle n'en est pas un), autre (autre manipulation caractérisée : appel à la peur, faux dilemme, récit complotiste… ; une accroche humoristique ou une mise en scène pédagogique n'en est pas).
   Pour chacun : "t", "quote", "explanation" (une phrase).
   Ne signale un procédé que s'il sert clairement à persuader ou à vendre. Une anecdote neutre, une présentation de son parcours ou un avertissement honnête (« ce sera difficile ») n'en sont pas. Une appréciation positive (« vaut le détour », « plus réaliste ») ne constitue pas une garantie de résultat.\n   Ne déduis jamais qu'un modèle, produit ou événement récent n'existe pas à partir de tes connaissances internes ou de l'absence de source dans cette étape. Classe l'annonce en affirmation à vérifier par la recherche web, pas en procédé de persuasion. En cas de doute sur un procédé, ne le signale pas.
4. Classement :
${categoryInstructions(categories)}

Réponds UNIQUEMENT avec ce JSON :
{"summary":"...","category":"...","tags":["..."],"claims":[{"t":0,"quote":"...","claim":"...","type":"fait","importance":2,"time_sensitive":false,"queries":["..."]}],"rhetoric":[{"t":0,"technique":"urgence","quote":"...","explanation":"..."}]}`;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export async function extractClaims(
  video: VideoInput,
  transcript: string,
  engine: JsonEngine,
  categories: string[] = [],
): Promise<{ extraction: Extraction; model: string }> {
  const { data, model } = await engine(buildExtractionMessages(video, transcript, categories), ExtractionSchema);
  const claims = data.claims.slice(0, MAX_CLAIMS).map((c, i) => {
    const queries = c.queries.map((q) => q.trim()).filter(Boolean).slice(0, 2);
    return {
      id: `C${i + 1}`,
      timestampS: c.t,
      quote: c.quote,
      claim: c.claim,
      type: c.type,
      importance: c.importance,
      ...(c.time_sensitive ? { timeSensitive: true } : {}),
      queries: queries.length ? queries : [c.claim],
    };
  });
  const rhetoric = data.rhetoric.map((r) => ({ timestampS: r.t, technique: r.technique, quote: r.quote, explanation: r.explanation }));
  const category = data.category.trim() ? normalizeCategory(data.category, categories) : '';
  return { extraction: { summary: data.summary, category, tags: cleanTags(data.tags), claims, rhetoric }, model };
}
