import type { TtsEngine } from './voices';

export const CLAIM_TYPES = ['fait', 'promesse_commerciale', 'opinion'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VERDICTS = ['vrai', 'plutot_vrai', 'exagere', 'trompeur', 'faux', 'inverifiable'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const TECHNIQUES = [
  'urgence',
  'rarete',
  'generalisation',
  'temoignage_inverifiable',
  'promesse_resultat',
  'autorite_douteuse',
  'conflit_interet',
  'certitude_abusive',
  'autre',
] as const;
export type Technique = (typeof TECHNIQUES)[number];

export const DEFAULT_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'inclusionai/ling-3.1-flash',
];

export interface Segment {
  start: number;
  text: string;
}

export interface VideoInput {
  videoId: string;
  title: string;
  author: string;
  /** Identifiant de la chaîne (UC…), pour l'analyse de chaîne. */
  channelId?: string;
  description: string;
  durationS: number;
  publishedAt?: string;
  language: string;
  segments: Segment[];
  /** Origine de la transcription : sous-titres YouTube ou transcription audio par Gemini. */
  transcriptSource?: 'captions' | 'gemini';
}

export interface Claim {
  id: string;
  timestampS: number;
  quote: string;
  claim: string;
  type: ClaimType;
  importance: number;
  queries: string[];
  /** Affirmation concernant une annonce ou une information susceptible d'avoir changé récemment. */
  timeSensitive?: boolean;
}

export interface RhetoricItem {
  timestampS: number;
  technique: Technique;
  quote: string;
  explanation: string;
}

export interface Extraction {
  summary: string;
  category: string;
  tags: string[];
  claims: Claim[];
  rhetoric: RhetoricItem[];
}

export type EvidenceSource = 'factcheck' | 'serper' | 'jina' | 'scraperapi';

export interface RawEvidence {
  url: string;
  title: string;
  snippet: string;
  date?: string;
  /** Horodatage de la collecte ; distinct de la date de publication. */
  retrievedAt?: string;
  source: EvidenceSource;
  rating?: string;
  publisher?: string;
}

export interface Evidence extends RawEvidence {
  id: string;
  claimId: string;
}

export interface ClaimVerdict {
  claimId: string;
  verdict: Verdict;
  confidence: number;
  explanation: string;
  correction?: string;
  evidenceIds: string[];
  /** Part des passages de vérification qui ont donné ce verdict (1 = unanimité). */
  agreement?: number;
}

export type Reliability = 'haute' | 'moyenne' | 'faible';

export interface Scores {
  facts: number | null;
  discourse: number;
  coverage: number;
  label: string;
  /** Plus petit et plus grand score des faits obtenus selon les passages de vérification. */
  range?: [number, number];
  /** Confiance dans la note elle-même (nombre d'affirmations vérifiées, couverture, accord entre passages). */
  reliability?: Reliability;
  passes?: number;
}

export interface Report {
  version: 1;
  videoId: string;
  title: string;
  author: string;
  createdAt: string;
  models: string[];
  /** Modèles réellement utilisés à chaque étape, y compris après un repli. */
  modelsByStage?: { extraction: string; verification: string };
  summary: string;
  category?: string;
  tags?: string[];
  claims: Claim[];
  verdicts: ClaimVerdict[];
  evidence: Evidence[];
  rhetoric: RhetoricItem[];
  scores: Scores;
  warnings: string[];
}

export interface Config {
  openrouterKey: string;
  serperKey?: string;
  jinaKey?: string;
  factcheckKey?: string;
  scraperapiKey?: string;
  /** Clé Gemini (Google AI Studio) : transcription audio des vidéos sans sous-titres. */
  geminiKey?: string;
  /** Clé Gemini de secours : prend le relais automatiquement quand le quota de la première est épuisé. */
  geminiKey2?: string;
  models: string[];
  /** Enregistre automatiquement rapports et discussions dans la base de connaissances (défaut : oui). */
  autoSave?: boolean;
  /** Langue de traduction des transcriptions et sous-titres (défaut : fr). */
  targetLang?: string;
  /** Doublage vocal : moteur, voix par moteur, volume de la vidéo d'origine (0 à 1) pendant le doublage. */
  ttsEngine?: TtsEngine;
  geminiVoice?: string;
  geminiTtsModel?: string;
  piperVoice?: string;
  browserVoice?: string;
  duckVolume?: number;
  /** Met la vidéo en pause si la voix du passage suivant n'est pas prête (défaut : oui). */
  dubWait?: boolean;
  /** Une voix par intervenant, identifiés par Gemini (défaut : oui si une clé Gemini existe). */
  dubMultiVoice?: boolean;
  /** Profil de l'utilisateur (domaines, niveau), transmis au LLM pour adapter le lexique et le tuteur. */
  userProfile?: string;
}

export type ProgressStep = 'transcript' | 'extract' | 'search' | 'verify' | 'done';
export type OnProgress = (step: ProgressStep, detail?: string) => void;
export type FetchFn = typeof fetch;

export type UserErrorCode = 'no_captions' | 'unavailable' | 'quota' | 'llm' | 'config';

/** Erreur dont le message est destiné à être affiché tel quel à l'utilisateur. */
export class UserError extends Error {
  readonly code: UserErrorCode;
  constructor(code: UserErrorCode, message: string) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}
