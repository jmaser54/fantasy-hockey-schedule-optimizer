/// <reference types="vitest/config" />
import { copyFileSync, createReadStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Screenshot import (Upload Image) runs Tesseract.js in the browser. Its worker, WASM core and English
 * model are served from this site under ocr/ (no CDN), copied from node_modules at build time and
 * served from there in dev. Only one core variant is downloaded, the one the browser supports.
 */
const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
const fromModules = (p: string) => resolve(import.meta.dirname, 'node_modules', p);

function ocrAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'ocr-assets',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([^/?]+)/.exec(req.url ?? '');
        const src = m && OCR_FILES[m[1]!];
        if (!src) return next();
        res.setHeader('Content-Type', m[1]!.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        createReadStream(fromModules(src)).pipe(res);
      });
    },
    writeBundle() {
      mkdirSync(resolve(outDir, 'ocr'), { recursive: true });
      for (const [name, src] of Object.entries(OCR_FILES)) copyFileSync(fromModules(src), resolve(outDir, 'ocr', name));
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), ocrAssets()],
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', 'scripts/**'],
  },
});
