import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * D1 integration suite (`pnpm test:d1`) — runs inside Cloudflare's `workerd` runtime via Miniflare
 * with a real, local, in-process D1 binding named `DB`, so Glossa's runtime takes the same
 * `D1DatabaseAdapter` path it takes in production.
 *
 * Deliberately configured through the `miniflare` option and **not** `wrangler.jsonc`: the
 * production config holds the real database id, and this suite must be incapable of reading it.
 * `d1Databases` values here are only local persistence keys — nothing contacts Cloudflare.
 *
 * Separate from `vitest.config.ts` (Angular/Node unit tests, which exclude `test/d1`).
 */
export default defineConfig({
  // Silences one "Sourcemap ... points to missing source files" warning per @forge-cms module.
  logLevel: 'error',
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-08-25',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'glossa-d1-integration-test' },
      },
    }),
  ],
  test: {
    globals: true,
    include: ['test/d1/**/*.d1.test.ts'],
  },
});
