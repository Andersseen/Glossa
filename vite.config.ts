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
    // Angular core reads a *bare* `ngDevMode` identifier in production code paths (not
    // `typeof ngDevMode`, which never throws) — safe only because Angular's own browser
    // bootstrap sets `globalThis.ngDevMode` before anything else runs. The SSR/server bundle
    // has no such guarantee: nothing in this app relies on `@angular/build`'s Angular CLI
    // pipeline, which is what normally applies this same `define` for production. Without it,
    // a `ReferenceError: ngDevMode is not defined` is one Vite chunk-splitting decision away —
    // it depends on load order the bundler owes no guarantee, and it can appear or disappear
    // with an unrelated code change (this exact regression was bisected against a prior commit
    // that happened to chunk things in an order where it didn't surface). `define` removes the
    // identifier at build time instead of leaving it to that ordering: every `ngDevMode`
    // reference across the whole SSR bundle — Angular core included — becomes the literal
    // `false`, so there is nothing left to reference at runtime, in Node or in a Workers preview
    // (`pnpm preview`, `pnpm preview:cf`) or once actually deployed.
    define:
      command === 'build'
        ? {
            ngDevMode: 'false',
          }
        : undefined,
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
