import { defineConfig } from 'vite';

// En-têtes d'isolation multi-origine : permettent à onnxruntime d'utiliser plusieurs threads.
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  root: 'scripts/piper-test',
  publicDir: '../../extension/public',
  worker: { format: 'es' },
  build: { outDir: '../../out/piper-test', emptyOutDir: true },
  preview: { headers: process.env.ISOLATED ? isolation : {} },
});
