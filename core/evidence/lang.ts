const COUNTRY: Record<string, string> = { fr: 'fr', en: 'us', es: 'es', de: 'de', it: 'it', pt: 'br' };

export const countryFor = (lang: string) => COUNTRY[lang] ?? 'us';
