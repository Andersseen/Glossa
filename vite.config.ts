/// <reference types="vitest" />

import { readFileSync } from 'node:fs';

import { defineConfig } from 'vite';
import analog from '@analogjs/platform';
import tailwindcss from '@tailwindcss/vite';

/**
 * Loads `.dev.vars` (the gitignored local-secrets file Wrangler already reads) into `process.env`
 * for the dev server. Server code reads configuration through `process.env`, and Vite does not
 * populate it from any env file, so without this `pnpm dev` starts with no `DEV_AUTH_*`/`AUTH_SECRET`
 * and SSO fails as "provider unavailable". Never overwrites a variable that is already set, so an
 * inline `FOO=bar pnpm dev` and Playwright's `webServer` env still win.
 */
function loadDevVars(): void {
  let contents: string;

  try {
    contents = readFileSync(new URL('.dev.vars', import.meta.url), 'utf8');
  } catch {
    return;
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  if (command === 'serve') loadDevVars();

  return {
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
  };
});
