/// <reference types="vitest" />

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(() => ({
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  server: {
    warmup: {
      // Pre-transform every route and its SSR counterpart on server start
      // instead of on first request. Without this, the first real hit to a
      // route Vite hasn't seen yet (e.g. a cold `pnpm dev` in CI) can race
      // Vite's on-demand dependency optimization and fail client-side with
      // "Failed to fetch dynamically imported module".
      clientFiles: ['./src/main.ts', './src/app/pages/**/*.page.ts'],
      ssrFiles: ['./src/main.server.ts', './src/app/pages/**/*.page.ts'],
    },
  },
  plugins: [
    analog({
      ssr: true,
      prerender: {
        routes: [],
      },
    }),
    tailwindcss(),
  ],
}));
