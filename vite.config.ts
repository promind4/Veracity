import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './extension/manifest.json' with { type: 'json' };

export default defineConfig({
  root: 'extension',
  plugins: [crx({ manifest })],
  // Le worker Piper charge ses modules dynamiquement : format ES requis.
  worker: { format: 'es' },
  build: { outDir: '../dist', emptyOutDir: true },
});
