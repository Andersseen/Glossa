import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { saveCatalog } from './catalog.service';
import { createProject } from './project.service';
import { getTranslationAnalysis } from './translation-analysis.service';

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

async function setUpProject(
  cms: GlossaCmsRuntime,
  locales: string[] = ['en', 'es', 'uk'],
): Promise<void> {
  await createProject(cms, {
    name: 'Volt UI',
    slug: 'volt-ui',
    sourceLocale: 'en',
    locales,
  });
}

describe('getTranslationAnalysis', () => {
  it('derives per-locale coverage and structural diffs from the loaded catalogs', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home', docs: 'Documentation' },
      title: 'Glossa',
    });
    await saveCatalog(cms, 'volt-ui', 'es', {
      nav: { home: 'Inicio' },
      legacy: 'Viejo',
    });

    const result = await getTranslationAnalysis(cms, 'volt-ui');

    expect(result.project).toEqual({
      slug: 'volt-ui',
      name: 'Volt UI',
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    });
    expect(result.analysis.sourceKeys).toBe(3);

    const es = result.analysis.locales.find((locale) => locale.locale === 'es');
    expect(es).toMatchObject({
      catalogExists: true,
      totalSourceKeys: 3,
      translatedKeys: 1,
      missingKeys: ['nav.docs', 'title'],
      extraKeys: ['legacy'],
      coverage: 1 / 3,
    });

    const uk = result.analysis.locales.find((locale) => locale.locale === 'uk');
    expect(uk).toEqual({
      locale: 'uk',
      isSource: false,
      catalogExists: false,
      totalSourceKeys: 3,
      translatedKeys: 0,
      missingKeys: ['nav.home', 'nav.docs', 'title'],
      extraKeys: [],
      coverage: 0,
    });
  });

  it('reports the source locale as fully covered relative to itself', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const result = await getTranslationAnalysis(cms, 'volt-ui');

    expect(result.analysis.locales).toEqual([
      {
        locale: 'en',
        isSource: true,
        catalogExists: true,
        totalSourceKeys: 1,
        translatedKeys: 1,
        missingKeys: [],
        extraKeys: [],
        coverage: 1,
      },
    ]);
    expect(result.analysis.completeKeys).toBe(1);
    expect(result.analysis.incompleteKeys).toBe(0);
  });
});
