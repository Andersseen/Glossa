import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { createProject } from './project.service';
import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
  deleteCatalog,
  getCatalog,
  listCatalogs,
  saveCatalog,
} from './catalog.service';
import { ProjectNotFoundError } from './project.service';
import { CatalogValidationError } from '../domain/catalog';

async function createTestRuntime(): Promise<GlossaCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      auth: new UsersCollectionAuthAdapter({ devMode: true }),
      storage: new InMemoryStorageAdapter(),
    },
    env: { userDatabase: database },
  }).init();

  await runtime.syncSchema();
  return runtime;
}

describe('catalog service', () => {
  it('creates, reads, updates and deletes a catalog', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });

    const created = await saveCatalog(cms, 'volt-ui', 'en', {
      common: { save: 'Save', cancel: 'Cancel' },
    });
    expect(created).toMatchObject({
      locale: 'en',
      namespace: '',
      content: { common: { save: 'Save', cancel: 'Cancel' } },
    });

    const read = await getCatalog(cms, 'volt-ui', 'en');
    expect(read.content).toEqual({
      common: { save: 'Save', cancel: 'Cancel' },
    });

    const updated = await saveCatalog(cms, 'volt-ui', 'en', {
      common: { save: 'Save', cancel: 'Cancel', close: 'Close' },
    });
    expect(updated.content).toEqual({
      common: { save: 'Save', cancel: 'Cancel', close: 'Close' },
    });

    const deleted = await deleteCatalog(cms, 'volt-ui', 'en');
    expect(deleted.locale).toBe('en');

    await expect(getCatalog(cms, 'volt-ui', 'en')).rejects.toBeInstanceOf(
      CatalogNotFoundError,
    );
  });

  it('lists only the catalogs that exist for a project', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    });
    await saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Save' } });

    const catalogs = await listCatalogs(cms, 'volt-ui');

    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]).toMatchObject({ locale: 'en' });
  });

  it('rejects a locale that is not configured on the project', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await expect(
      saveCatalog(cms, 'volt-ui', 'fr', { common: { save: 'Save' } }),
    ).rejects.toThrow('Locale "fr" is not configured for this project.');
    await expect(
      saveCatalog(cms, 'volt-ui', 'fr', { common: { save: 'Save' } }),
    ).rejects.toBeInstanceOf(CatalogLocaleNotConfiguredError);
  });

  it('fails for a project that does not exist', async () => {
    const cms = await createTestRuntime();

    await expect(
      saveCatalog(cms, 'missing-project', 'en', { common: { save: 'Save' } }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('rejects an invalid root and an invalid leaf', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await expect(
      saveCatalog(cms, 'volt-ui', 'en', ['Save', 'Cancel']),
    ).rejects.toThrow('Catalog root must be an object.');

    await expect(
      saveCatalog(cms, 'volt-ui', 'en', { common: { count: 42 } }),
    ).rejects.toThrow(
      'Translation value at "common.count" must be a string or object.',
    );
  });

  it('never overwrites the stored catalog when the new content is invalid', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Save' } });

    await expect(
      saveCatalog(cms, 'volt-ui', 'en', { common: { count: 42 } }),
    ).rejects.toBeInstanceOf(CatalogValidationError);

    const catalog = await getCatalog(cms, 'volt-ui', 'en');
    expect(catalog.content).toEqual({ common: { save: 'Save' } });
  });

  it('saves at most one catalog per project and locale', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Save' } });
    await saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Guardar' } });

    const catalogs = await listCatalogs(cms, 'volt-ui');
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]?.content).toEqual({ common: { save: 'Guardar' } });
  });

  it('keeps catalog saves race-safe with the compound unique constraint', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await Promise.all([
      saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Save' } }),
      saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Store' } }),
    ]);

    const catalogs = await listCatalogs(cms, 'volt-ui');
    expect(catalogs).toHaveLength(1);
  });

  it('preserves string values exactly, including MessageFormat 2 syntax', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const message = '{count, plural, one {# item} other {# items}}';

    await saveCatalog(cms, 'volt-ui', 'en', { count: message });
    const catalog = await getCatalog(cms, 'volt-ui', 'en');

    expect(catalog.content['count']).toBe(message);
  });
});
