import type { Technique, Verdict } from './types';

export const VERDICT_LABEL: Record<Verdict, string> = {
  vrai: 'Vrai',
  plutot_vrai: 'Plutôt vrai',
  exagere: 'Exagéré',
  trompeur: 'Trompeur',
  faux: 'Faux',
  inverifiable: 'Invérifiable',
};

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  urgence: 'Urgence artificielle',
  rarete: 'Fausse rareté',
  generalisation: 'Généralisation abusive',
  temoignage_inverifiable: 'Témoignage invérifiable',
  promesse_resultat: 'Promesse de résultat',
  autorite_douteuse: 'Autorité douteuse',
  conflit_interet: "Conflit d'intérêts",
  certitude_abusive: 'Certitude abusive',
  autre: 'Autre procédé',
};

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
