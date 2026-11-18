// Catalogue des voix de doublage, partagé par la page d'options et le side panel.

export type TtsEngine = 'gemini' | 'piper' | 'browser';

export const TTS_ENGINES: Record<TtsEngine, string> = {
  gemini: 'Gemini (clé API, quotas selon le compte)',
  piper: 'Piper (calcul local, téléchargement de la voix au premier usage)',
  browser: 'Voix disponibles sur cet appareil',
};

/** Voix Piper par langue cible (identifiants du dépôt rhasspy/piper-voices). */
export const PIPER_VOICES: Record<string, { id: string; label: string }[]> = {
  fr: [
    { id: 'fr_FR-siwis-medium', label: 'Siwis (féminine)' },
    { id: 'fr_FR-tom-medium', label: 'Tom (masculine)' },
    { id: 'fr_FR-upmc-medium', label: 'UPMC (féminine)' },
    { id: 'fr_FR-gilles-low', label: 'Gilles (masculine, légère)' },
  ],
  en: [
    { id: 'en_US-lessac-medium', label: 'Lessac (américaine)' },
    { id: 'en_GB-alan-medium', label: 'Alan (britannique)' },
  ],
  es: [
    { id: 'es_ES-davefx-medium', label: 'Davefx (Espagne)' },
    { id: 'es_MX-claude-high', label: 'Claude (Mexique)' },
  ],
  de: [{ id: 'de_DE-thorsten-medium', label: 'Thorsten' }],
  it: [{ id: 'it_IT-riccardo-x_low', label: 'Riccardo' }],
  pt: [{ id: 'pt_BR-faber-medium', label: 'Faber (Brésil)' }],
};

/** Voix Piper retenue : la préférence si elle existe pour cette langue, sinon la première. */
export function piperVoiceFor(lang: string, preferred?: string): string | undefined {
  const voices = PIPER_VOICES[lang] ?? [];
  return voices.find((v) => v.id === preferred)?.id ?? voices[0]?.id;
}
