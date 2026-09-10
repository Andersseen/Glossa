import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter,
} from '@forge-cms/auth';
import type { CollectionDefinition } from '@forge-cms/core';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { GlossaSsoAuthAdapter } from '../auth/glossa-sso-auth-adapter';
import { catalogsCollection } from './collections/catalogs';
import { externalIdentitiesCollection } from './collections/external-identities';
import { projectsCollection } from './collections/projects';
import { ssoSessionsCollection } from './collections/sso-sessions';
import { usersCollection } from './collections/users';

export type GlossaCmsEnv = {
  AUTH_SECRET?: string;
  BOOTSTRAP_ADMIN_KEY?: string;
  DEV_AUTH_ISSUER?: string;
  DEV_AUTH_CLIENT_ID?: string;
  DEV_AUTH_CLIENT_SECRET?: string;
  DEV_AUTH_REDIRECT_URI?: string;
  DB?: D1Database;
};

type AuthEnv = GlossaCmsEnv & {
  userDatabase: D1DatabaseAdapter | InMemoryDatabaseAdapter;
  apiKeyDatabase: D1DatabaseAdapter | InMemoryDatabaseAdapter;
};

/**
 * Non-secret label on every Glossa-issued project access token (`glossa_<recordId>_<secret>`).
 * Distinct enough from `SSO_TOKEN_PREFIX` (`glossa_sso_...`, session-token.ts) that a real SSO
 * token is always claimed by `GlossaSsoAuthAdapter` first in the composite order below — an
 * expired/invalid SSO token falling through to `ApiKeyAuthAdapter`'s cheap format check is a
 * harmless extra lookup, never an authentication bypass (see composite-auth.spec.ts).
 */
export const PROJECT_TOKEN_PREFIX = 'glossa';

const typedUsersCollection = usersCollection as CollectionDefinition<
  'users',
  typeof usersCollection.fields
>;

export const collections = [
  typedUsersCollection,
  projectsCollection,
  catalogsCollection,
  externalIdentitiesCollection,
  ssoSessionsCollection,
] satisfies [
  typeof typedUsersCollection,
  typeof projectsCollection,
  typeof catalogsCollection,
  typeof externalIdentitiesCollection,
  typeof ssoSessionsCollection,
];

export type GlossaCmsRuntime = ForgeCmsRuntime<AuthEnv, typeof collections>;

let memoryRuntime: GlossaCmsRuntime | undefined;
let memoryRuntimeReady: Promise<GlossaCmsRuntime> | undefined;

/**
 * DevAuth SSO is the primary login path; Forge local password auth remains a break-glass
 * fallback; `ApiKeyAuthAdapter` authenticates machine (`role: 'machine'`) callers of the machine
 * catalog API. `GlossaSsoAuthAdapter`'s `canHandleToken` (a `glossa_sso_...` prefix check),
 * `UsersCollectionAuthAdapter`'s (a signed `payload.signature` shape check), and
 * `ApiKeyAuthAdapter`'s (a `glossa_<id>_<secret>` shape check) cleanly discriminate the three
 * token formats, so `CompositeAuthAdapter` never needs route-level branching. Order matters only
 * for the SSO-prefix edge case documented at `PROJECT_TOKEN_PREFIX` — SSO is tried first.
 */
export function createCmsRuntime(env: GlossaCmsEnv = {}): GlossaCmsRuntime {
  if (env?.DB) {
    const database = new D1DatabaseAdapter({ binding: 'DB' });
    const auth = new CompositeAuthAdapter([
      new GlossaSsoAuthAdapter(),
      new UsersCollectionAuthAdapter(),
      new ApiKeyAuthAdapter({ prefix: PROJECT_TOKEN_PREFIX }),
    ]);

    return new ForgeCmsRuntime<AuthEnv, typeof collections>({
      collections,
      adapters: {
        database,
        auth,
        storage: new InMemoryStorageAdapter(),
      },
      env: { ...env, userDatabase: database, apiKeyDatabase: database },
    }).init();
  }

  const database = new InMemoryDatabaseAdapter();

  memoryRuntime ??= new ForgeCmsRuntime<AuthEnv, typeof collections>({
    collections,
    adapters: {
      database,
      auth: new CompositeAuthAdapter([
        new GlossaSsoAuthAdapter(),
        new UsersCollectionAuthAdapter({ devMode: true }),
        new ApiKeyAuthAdapter({ prefix: PROJECT_TOKEN_PREFIX }),
      ]),
      storage: new InMemoryStorageAdapter(),
    },
    env: { ...env, userDatabase: database, apiKeyDatabase: database },
  }).init();

  return memoryRuntime;
}

/**
 * The password-auth adapter for direct use (login, bootstrap's `createUser`/`listUsers`) —
 * `runtime.adapters.auth` is a `CompositeAuthAdapter` once DevAuth SSO is wired in, and
 * `CompositeAuthAdapter` deliberately exposes only the common `AuthAdapter` surface, not each child
 * adapter's own extra methods. This builds a fresh `UsersCollectionAuthAdapter` bound to the exact
 * same `userDatabase`/`AUTH_SECRET` the runtime already uses (via `runtime.config.env`), which is
 * functionally identical to reaching into the composite — `UsersCollectionAuthAdapter` carries no
 * state beyond that database/secret binding.
 */
export function getPasswordAuthAdapter(
  runtime: GlossaCmsRuntime,
): UsersCollectionAuthAdapter {
  const env = runtime.config.env;

  if (!env) {
    throw new Error('CMS runtime has no environment configured.');
  }

  const adapter = env.DB
    ? new UsersCollectionAuthAdapter()
    : new UsersCollectionAuthAdapter({ devMode: true });

  return adapter.init(env);
}

/**
 * The API-key adapter for direct use (project token create/list/get/revoke/delete) — same
 * rationale as `getPasswordAuthAdapter`: `CompositeAuthAdapter` deliberately exposes only the
 * common `AuthAdapter` surface, not each child adapter's own extra methods, so this builds a
 * fresh `ApiKeyAuthAdapter` bound to the exact same `apiKeyDatabase` the runtime already uses.
 */
export function getProjectApiKeyAdapter(
  runtime: GlossaCmsRuntime,
): ApiKeyAuthAdapter {
  const env = runtime.config.env;

  if (!env) {
    throw new Error('CMS runtime has no environment configured.');
  }

  return new ApiKeyAuthAdapter({ prefix: PROJECT_TOKEN_PREFIX }).init(env);
}

export async function getCmsRuntime(
  env: GlossaCmsEnv = {},
): Promise<GlossaCmsRuntime> {
  if (env.DB) {
    const runtime = createCmsRuntime(env);
    await runtime.syncSchema();
    return runtime;
  }

  memoryRuntimeReady ??= (async () => {
    const runtime = createCmsRuntime(env);
    await runtime.syncSchema();
    return runtime;
  })();

  return memoryRuntimeReady;
}
