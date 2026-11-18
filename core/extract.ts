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
        context: z.enum(['real', 'fiction', 'unclear']).catch('unclear').optional(),
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
  const user = `Analyse ${video.platform === 'x' ? 'cette publication X et les sous-titres vid�o disponibles' : 'cette vid�o YouTube'}. Date de l'analyse : ${new Date().toISOString().slice(0, 10)}.
${video.platform === 'x' ? "Le texte de la publication est fourni dans la description. Il peut contenir des affirmations � v�rifier : inclus-les m�me s'il n'y a pas de paroles vid�o. Les paroles �ventuelles sont fournies s�par�ment. Distingue strictement la r�alit� d'un jeu vid�o, d'une fiction, d'une simulation ou d'un jeu de r�le : si le contexte indique un jeu, dis que la personne joue ou que son personnage agit dans le jeu, sans transformer ces �v�nements en faits r�els. Les propos d'un personnage ou une narration � la premi�re personne ne sont pas automatiquement des faits sur l'auteur. Si le contexte ne permet pas d'�tablir ce qui est montr�, ne l'invente pas. Ne pr�tends pas avoir vu ou entendu la vid�o si les sous-titres sont absents. Ne qualifie pas une vid�o de g�n�r�e par IA sans preuve." : ''}

<titre>${video.title}</titre>
<chaine>${video.author}</chaine>
${video.publishedAt ? `<date_publication>${video.publishedAt}</date_publication>` : ''}
<description>
${video.description.slice(0, 5000)}
</description>
<transcription langue="${video.language}">
${transcript}
</transcription>

T�ches :
${video.platform === 'x' ? `Pour chaque affirmation X, ajoute "context" : "real" si elle porte sur le monde r�el (y compris un fait sur le jeu lui-m�me), "fiction" si elle d�crit une action dans un jeu ou un r�cit, "unclear" si les sources fournies ne permettent pas de les distinguer. Ne pr�sente aucune action fictive ou ambigu� comme un �v�nement r�el dans le r�sum�. Si le tweet fournit le contexte d'une r�plique, conserve ce contexte dans ta reformulation.` : ''}
1. "summary" : r�sum� neutre de la vid�o en 3 � 5 phrases.
2. "claims" : au maximum ${MAX_CLAIMS} affirmations, les plus importantes pour juger la fiabilit� de la vid�o. Priorit� aux affirmations pr�cises et v�rifiables : chiffres, dates, statistiques, �tudes cit�es, lois, faits historiques ou scientifiques, r�sultats promis.
   - "t" : horodatage en secondes o� l'affirmation est prononc�e (d'apr�s les rep�res [m:ss]).
   - "quote" : citation exacte et courte ${video.platform === 'x' ? 'du texte de la publication ou des sous-titres fournis' : 'de la transcription'}.
   - "claim" : reformulation autonome et pr�cise (qui, quoi, quand), compr�hensible sans la vid�o, fid�le � ce qui est dit : n'ajoute ni hypoth�se ni pr�cision de ton cru (pas de � probablement �, pas de nom ou de date que la personne n'a pas donn�s). Une pr�diction ou une sp�culation est une "opinion", pas un "fait".
   - "type" : "fait" (v�rifiable objectivement), "promesse_commerciale" (gains, r�sultats, offres, garanties) ou "opinion" (jugement subjectif).
   - "importance" : 1 (d�tail ou contexte), 2 (notable) ou 3 (central : la th�se de la vid�o ou un argument qui la soutient). Un fait de contexte (date d'un livre cit�, biographie, historique) vaut 1, m�me s'il est souvent r�p�t�.
   - Si la vid�o d�fend une th�se factuelle (� la Terre est plate �, � ce traitement gu�rit X �, � cette crypto va faire x100 �), inclus cette th�se elle-m�me comme affirmation d'importance 3.
   - "time_sensitive" : true si la v�rit� de l'affirmation peut changer rapidement (annonce de sortie, lancement, disponibilit�, version, prix, loi r�cente, �v�nement en cours), false pour un fait historique ou stable. Cela d�clenche une recherche web renforc�e.
   - "queries" : 1 ou 2 requ�tes Google courtes, dans la langue la plus pertinente pour trouver des sources fiables. Pour une annonce r�cente (mod�le, produit, �tude, r�glementation), inclure le nom exact et, si pertinent, son �diteur ou son organisme afin de retrouver l'annonce officielle.
   - N'extrais pas les modalit�s d'une offre (prix, r�duction, places restantes, date limite) : elles rel�vent de "rhetoric", pas de "claims".
   - Pr�f�re les affirmations sur le monde (chiffres, lois, �tudes, �v�nements) aux d�tails de la vie priv�e de l'auteur, sauf s'ils servent d'argument central (revenus mis en avant pour vendre, par exemple).
3. "rhetoric" : les proc�d�s de persuasion ou de manipulation pr�sents. "technique" parmi :
   urgence (d�lai artificiel), rarete (stock ou places limit�es), generalisation (� tout le monde �, � 95 % des gens � sans source), temoignage_inverifiable (succ�s personnel ou d'�l�ves inv�rifiable), promesse_resultat (gain, r�ussite ou r�sultat personnel garanti au spectateur ; un appel � l'action collective ou d'int�r�t g�n�ral n'en est pas), autorite_douteuse (expert, �tude ou institution cit�e VAGUEMENT : � des scientifiques disent �, � une �tude montre � sans la nommer ; un expert nomm� avec sa fonction ou son institution n'en est pas un), conflit_interet (l'auteur vend ou touche une commission sur ce que la vid�o recommande sans le signaler clairement : formation, produit, plateforme via lien affili� ou code promo, sponsor non signal� ; un partenariat ou un sponsor explicitement annonc� n'en est pas un), certitude_abusive (pr�diction ou sp�culation pr�sent�e comme certaine ou facile, risques minimis�s ou pass�s sous silence ; annoncer la sortie d'un produit ou d'un mod�le n'en est pas un), autre (autre manipulation caract�ris�e : appel � la peur, faux dilemme, r�cit complotiste. ; une accroche humoristique ou une mise en sc�ne p�dagogique n'en est pas).
   Pour chacun : "t", "quote", "explanation" (une phrase).
   Ne signale un proc�d� que s'il sert clairement � persuader ou � vendre. Une anecdote neutre, une pr�sentation de son parcours ou un avertissement honn�te (� ce sera difficile �) n'en sont pas. Une appr�ciation positive (� vaut le d�tour �, � plus r�aliste �) ne constitue pas une garantie de r�sultat.\n   Ne d�duis jamais qu'un mod�le, produit ou �v�nement r�cent n'existe pas � partir de tes connaissances internes ou de l'absence de source dans cette �tape. Classe l'annonce en affirmation � v�rifier par la recherche web, pas en proc�d� de persuasion. En cas de doute sur un proc�d�, ne le signale pas.
4. Classement :
${categoryInstructions(categories)}

R�ponds UNIQUEMENT avec ce JSON :
{"summary":"...","category":"...","tags":["..."],"claims":[{"t":0,"quote":"...","claim":"...","type":"fait","importance":2,"time_sensitive":false,${video.platform === 'x' ? '"context":"real",' : ''}"queries":["..."]}],"rhetoric":[{"t":0,"technique":"urgence","quote":"...","explanation":"..."}]}`;
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
  const candidates = video.platform === 'x' ? data.claims.filter((c) => c.context === 'real') : data.claims;
  const claims = candidates.slice(0, MAX_CLAIMS).map((c, i) => {
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
  const summary = video.platform === 'x' && data.claims.length && !claims.length
    ? 'Les passages relev�s d�crivent une fiction, un jeu ou des �v�nements dont le contexte reste incertain. Aucune affirmation sur le monde r�el n'a �t� retenue.'
    : data.summary;
  return { extraction: { summary, category, tags: cleanTags(data.tags), claims, rhetoric }, model };
}
