import { PiperClient } from '../../extension/src/shared/tts/piper';

// Test manuel : même worker que l'extension ; alterne deux voix comme pour deux intervenants.
const log = (s: string) => ((document.getElementById('log') as HTMLElement).textContent += s + '\n');
const client = new PiperClient();
const lines: [string, string][] = [
  ['fr_FR-siwis-medium', 'Bonjour, je suis la journaliste.'],
  ['fr_FR-tom-medium', "Bonjour, entrez, je vous en prie."],
  ['fr_FR-siwis-medium', 'Merci beaucoup, ravie de vous rencontrer.'],
  ['fr_FR-tom-medium', 'Allons dans le salon.'],
];
(async () => {
  log(`isolé : ${crossOriginIsolated}, threads : ${navigator.hardwareConcurrency}`);
  const results: Record<string, unknown>[] = [];
  for (const [voice, text] of lines) {
    const t0 = performance.now();
    const out = await client.speak(text, voice);
    const ms = Math.round(performance.now() - t0);
    log(`${voice} : ${ms} ms, audio ${out.durationS.toFixed(2)} s`);
    results.push({ voice, ms, durationS: +out.durationS.toFixed(2) });
    (document.getElementById('player') as HTMLAudioElement).src = URL.createObjectURL(new Blob([out.wav], { type: 'audio/wav' }));
  }
  (window as unknown as { __result: unknown }).__result = results;
})().catch((e) => {
  log('ERREUR ' + e.message);
  (window as unknown as { __result: unknown }).__result = { error: e.message };
});
