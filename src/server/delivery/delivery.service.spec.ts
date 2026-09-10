import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
  saveCatalog,
} from '../services/catalog.service';
import {
  createProject,
  ProjectNotFoundError,
} from '../services/project.service';
import {
  buildPublicUrl,
  DeliveryDisabledError,
  getPublicCatalog,
  getPublicManifest,
} from './delivery.service';

async function createTestRuntime(): Promise<GlossaCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      auth: new UsersCollectionAuthAdapter({ devMode: true }),
      storage: new InMemoryStorageAdapter(),
    },
    env: { userDatabase: database, apiKeyDatabase: database },
  }).init();

  await runtime.syncSchema();
  return runtime;
}

const ORIGIN = 'https://glossa.andersseen.dev';

describe('delivery.service', () => {
  it('rejects a project that has never enabled public delivery', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });

    await expect(getPublicManifest(cms, 'volt-ui', ORIGIN)).rejects.toThrow(
      DeliveryDisabledError,
    );
    await expect(getPublicCatalog(cms, 'volt-ui', 'en')).rejects.toThrow(
      DeliveryDisabledError,
    );
  });

  it('rejects an unknown project the same way an existing-but-disabled one is rejected', async () => {
    const cms = await createTestRuntime();

    await expect(getPublicManifest(cms, 'missing', ORIGIN)).rejects.toThrow(
      ProjectNotFoundError,
    );
  });

  it('builds a manifest with only the catalogs that actually exist', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
      publicDelivery: true,
    });
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const manifest = await getPublicManifest(cms, 'volt-ui', ORIGIN);

    expect(manifest.project).toEqual({
      slug: 'volt-ui',
      name: 'Volt UI',
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    });
    expect(Object.keys(manifest.catalogs)).toEqual(['en']);
    expect(manifest.catalogs['en']?.url).toBe(`${ORIGIN}/i18n/volt-ui/en.json`);
    expect(typeof manifest.catalogs['en']?.revision).toBe('string');
  });

  it('returns the raw catalog content for an enabled project', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
      publicDelivery: true,
    });
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const catalog = await getPublicCatalog(cms, 'volt-ui', 'en');

    expect(catalog.content).toEqual({ nav: { home: 'Home' } });
  });

  it('rejects an unconfigured locale even when delivery is enabled', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
      publicDelivery: true,
    });

    await expect(getPublicCatalog(cms, 'volt-ui', 'fr')).rejects.toThrow(
      CatalogLocaleNotConfiguredError,
    );
  });

  it('rejects a configured-but-not-yet-created catalog', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es'],
      publicDelivery: true,
    });

    await expect(getPublicCatalog(cms, 'volt-ui', 'es')).rejects.toThrow(
      CatalogNotFoundError,
    );
  });

  it('reflects a write immediately (no separate publish step)', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
      publicDelivery: true,
    });
    await saveCatalog(cms, 'volt-ui', 'en', { title: 'v1' });

    expect((await getPublicCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      title: 'v1',
    });

    await saveCatalog(cms, 'volt-ui', 'en', { title: 'v2' });

    expect((await getPublicCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      title: 'v2',
    });
  });
});

describe('buildPublicUrl', () => {
  it('encodes the project slug and appends the path verbatim', () => {
    expect(buildPublicUrl(ORIGIN, 'volt ui', 'manifest.json')).toBe(
      `${ORIGIN}/i18n/volt%20ui/manifest.json`,
    );
  });
});
