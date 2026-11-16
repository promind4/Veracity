// Copie les moteurs WebAssembly de Piper dans l'extension (aucun code chargé depuis un CDN).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const target = 'extension/public/piper';
mkdirSync(target, { recursive: true });
const files = [
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper_phonemize.wasm'],
  ['node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper_phonemize.data'],
  ...['ort-wasm.wasm', 'ort-wasm-simd.wasm', 'ort-wasm-simd-threaded.wasm'].map((f) => [`node_modules/onnxruntime-web/dist/${f}`, f]),
];
for (const [from, name] of files) {
  if (!existsSync(from)) throw new Error(`Fichier manquant : ${from} (npm install ?)`);
  copyFileSync(from, `${target}/${name}`);
}
console.log(`Piper : ${files.length} fichiers copiés dans ${target}`);
