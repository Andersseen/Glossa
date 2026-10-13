import { env } from 'cloudflare:workers';
import { D1DatabaseAdapter } from '@forge-cms/cloudflare';

import {
  createCmsRuntime,
  type GlossaCmsEnv,
  type GlossaCmsRuntime,
} from '../../src/server/cms/runtime';

const TEST_ENV: GlossaCmsEnv = {
  DB: env.DB,
  AUTH_SECRET: 'd1-integration-test-secret-not-a-real-secret',
};

/**
 * A brand-new runtime over the shared test D1. Each call builds its own adapters, so nothing is
 * cached between calls: a value read through a second runtime came out of D1, not out of memory.
 * Mirrors `getCmsRuntime`'s D1 branch (`createCmsRuntime` + `syncSchema`).
 */
export async function openRuntime(): Promise<GlossaCmsRuntime> {
  if (!TEST_ENV.DB) {
    throw new Error('The D1 binding "DB" is missing; refusing to fall back.');
  }

  const runtime = createCmsRuntime(TEST_ENV);
  // `createCmsRuntime` quietly picks the in-memory adapter when `DB` is falsy — never accept that.
  assertD1Adapter(runtime);
  await runtime.syncSchema();
  return runtime;
}

/** Fails loudly if the persistence under test is anything other than the real D1 adapter. */
export function assertD1Adapter(runtime: GlossaCmsRuntime): void {
  const adapter = runtime.adapters.database;

  if (!(adapter instanceof D1DatabaseAdapter)) {
    throw new Error(
      `Expected D1DatabaseAdapter, got ${adapter.constructor.name}.`,
    );
  }
}

/**
 * Drops every user table so each test starts from an empty database, then lets the application's
 * own `syncSchema()` recreate the schema from nothing. Only ever touches the local test D1.
 */
export async function resetDatabase(): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
  ).all<{ name: string }>();

  await env.DB.batch([
    env.DB.prepare('PRAGMA defer_foreign_keys = on'),
    ...results.map(({ name }) =>
      env.DB.prepare(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`),
    ),
  ]);
}

export async function freshRuntime(): Promise<GlossaCmsRuntime> {
  await resetDatabase();
  return openRuntime();
}
