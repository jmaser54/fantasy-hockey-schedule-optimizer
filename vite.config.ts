/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/node_modules/**', 'scripts/**'],
  },
});
