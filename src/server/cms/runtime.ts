import { InMemoryAuthAdapter } from '@forge-cms/auth';
import { D1DatabaseAdapter, type D1Database } from '@forge-cms/cloudflare';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { catalogsCollection } from './collections/catalogs';
import { projectsCollection } from './collections/projects';

export type GlossaCmsEnv = {
  DB?: D1Database;
};

export type GlossaCmsRuntime = ForgeCmsRuntime<GlossaCmsEnv>;

const collections = [projectsCollection, catalogsCollection];

let memoryRuntime: GlossaCmsRuntime | undefined;

export function createCmsRuntime(env: GlossaCmsEnv = {}): GlossaCmsRuntime {
  if (env?.DB) {
    return new ForgeCmsRuntime<GlossaCmsEnv>({
      collections,
      adapters: {
        database: new D1DatabaseAdapter({ binding: 'DB' }),
        auth: new InMemoryAuthAdapter(),
        storage: new InMemoryStorageAdapter(),
      },
      env,
    }).init();
  }

  memoryRuntime ??= new ForgeCmsRuntime<GlossaCmsEnv>({
    collections,
    adapters: {
      database: new InMemoryDatabaseAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter(),
    },
    env,
  }).init();

  return memoryRuntime;
}
