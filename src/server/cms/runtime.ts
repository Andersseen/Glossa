import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import type { CollectionDefinition } from '@forge-cms/core';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { catalogsCollection } from './collections/catalogs';
import { projectsCollection } from './collections/projects';
import { usersCollection } from './collections/users';

export type GlossaCmsEnv = {
  AUTH_SECRET?: string;
  BOOTSTRAP_ADMIN_KEY?: string;
  DB?: D1Database;
};

type AuthEnv = GlossaCmsEnv & {
  userDatabase: D1DatabaseAdapter | InMemoryDatabaseAdapter;
};

const typedUsersCollection = usersCollection as CollectionDefinition<
  'users',
  typeof usersCollection.fields
>;

export const collections = [
  typedUsersCollection,
  projectsCollection,
  catalogsCollection,
] satisfies [
  typeof typedUsersCollection,
  typeof projectsCollection,
  typeof catalogsCollection,
];

export type GlossaCmsRuntime = ForgeCmsRuntime<AuthEnv, typeof collections>;

let memoryRuntime: GlossaCmsRuntime | undefined;
let memoryRuntimeReady: Promise<GlossaCmsRuntime> | undefined;

export function createCmsRuntime(env: GlossaCmsEnv = {}): GlossaCmsRuntime {
  if (env?.DB) {
    const database = new D1DatabaseAdapter({ binding: 'DB' });
    const auth = new UsersCollectionAuthAdapter();

    return new ForgeCmsRuntime<AuthEnv, typeof collections>({
      collections,
      adapters: {
        database,
        auth,
        storage: new InMemoryStorageAdapter(),
      },
      env: { ...env, userDatabase: database },
    }).init();
  }

  const database = new InMemoryDatabaseAdapter();

  memoryRuntime ??= new ForgeCmsRuntime<AuthEnv, typeof collections>({
    collections,
    adapters: {
      database,
      auth: new UsersCollectionAuthAdapter({ devMode: true }),
      storage: new InMemoryStorageAdapter(),
    },
    env: { ...env, userDatabase: database },
  }).init();

  return memoryRuntime;
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
