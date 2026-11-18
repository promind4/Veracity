/** Rapproche uniquement des équivalences explicites, sans fusionner parent et spécialité. */
export function topicKey(value: string): string {
  const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(?:et|and)\b/g, '').replace(/[^a-z0-9]+/g, '');
  const aliases: Record<string, string> = {
    ia: 'intelligenceartificielle', ai: 'intelligenceartificielle', artificialintelligence: 'intelligenceartificielle',
    machinelearning: 'apprentissageautomatique', ml: 'apprentissageautomatique',
    deeplearning: 'apprentissageprofond',
    computergraphics3d: 'infographie3d',
  };
  return aliases[key] ?? key;
}
