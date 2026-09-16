import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { InvalidTranslationKeyError } from '../domain/translation-path';
import { getCatalog, saveCatalog } from './catalog.service';
import { createProject } from './project.service';
import {
  deleteProjectTranslationKey,
  renameProjectTranslationKey,
  TranslationLifecycleConflictError,
  TranslationNotFoundError,
} from './translation-lifecycle.service';
import { TranslationValidationError } from './translation-workspace.service';

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

async function revisionOf(
  cms: GlossaCmsRuntime,
  locale: string,
): Promise<string> {
  return (await getCatalog(cms, 'volt-ui', locale)).revision;
}

async function revisionsOf(
  cms: GlossaCmsRuntime,
  locales: string[],
): Promise<Record<string, string>> {
  const revisions: Record<string, string> = {};

  for (const locale of locales) {
    revisions[locale] = await revisionOf(cms, locale);
  }

  return revisions;
}

describe('renameProjectTranslationKey', () => {
  it('renames a key present in every locale, preserving exact values', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home', docs: 'Docs' },
    });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    await saveCatalog(cms, 'volt-ui', 'uk', { nav: { home: 'Головна' } });
    const expectedRevisions = await revisionsOf(cms, ['en', 'es', 'uk']);

    const result = await renameProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      newKey: 'navigation.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.operation).toBe('rename');
    expect(result.results.map((entry) => entry.locale).sort()).toEqual([
      'en',
      'es',
      'uk',
    ]);

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { docs: 'Docs' },
      navigation: { home: 'Home' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      navigation: { home: 'Inicio' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'uk')).content).toEqual({
      navigation: { home: 'Головна' },
    });
  });

  it('leaves a target locale that never had the key untouched and unreported', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    await saveCatalog(cms, 'volt-ui', 'uk', {});
    const expectedRevisions = await revisionsOf(cms, ['en', 'es', 'uk']);

    const result = await renameProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      newKey: 'navigation.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.results.map((entry) => entry.locale).sort()).toEqual([
      'en',
      'es',
    ]);
    expect((await getCatalog(cms, 'volt-ui', 'uk')).content).toEqual({});
  });

  it('renames without touching a configured locale that has no catalog at all', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    const expectedRevisions = await revisionsOf(cms, ['en']);

    const result = await renameProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      newKey: 'navigation.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.results.map((entry) => entry.locale)).toEqual(['en']);
    expect(result.catalogs['uk']).toEqual({ exists: false });
    await expect(getCatalog(cms, 'volt-ui', 'uk')).rejects.toThrow();
  });

  it('rejects a rename when the new key already exists in another locale, and changes nothing', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', {
      navigation: { home: 'Existente' },
    });
    const expectedRevisions = await revisionsOf(cms, ['en', 'es']);

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        newKey: 'navigation.home',
        expectedRevisions,
      }),
    ).rejects.toThrow('already exists');

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      navigation: { home: 'Existente' },
    });
  });

  it('rejects a collision even when the existing target key is an orphan absent from the source', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', {
      nav: { home: 'Inicio' },
      navigation: { home: 'Huérfano' },
    });
    const expectedRevisions = await revisionsOf(cms, ['en', 'es']);

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        newKey: 'navigation.home',
        expectedRevisions,
      }),
    ).rejects.toThrow('already exists');
  });

  it('rejects renaming a key to itself', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        newKey: 'nav.home',
        expectedRevisions: await revisionsOf(cms, ['en']),
      }),
    ).rejects.toThrow(TranslationValidationError);
  });

  it('rejects an unsafe new key', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        newKey: 'nav.__proto__.home',
        expectedRevisions: await revisionsOf(cms, ['en']),
      }),
    ).rejects.toThrow(InvalidTranslationKeyError);
  });

  it('rejects a rename when the key does not exist in the source locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.missing',
        newKey: 'nav.renamed',
        expectedRevisions: await revisionsOf(cms, ['en']),
      }),
    ).rejects.toThrow(TranslationNotFoundError);
  });

  it('rejects a stale revision on any locale and writes nothing, including the source', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    const staleRevisions = await revisionsOf(cms, ['en', 'es']);

    // Someone else changes `es` after the caller "loaded" its revision above.
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Casa' } });

    await expect(
      renameProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        newKey: 'navigation.home',
        expectedRevisions: staleRevisions,
      }),
    ).rejects.toThrow(TranslationLifecycleConflictError);

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      nav: { home: 'Casa' },
    });
  });

  it('preserves a MessageFormat value byte-for-byte across the rename', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    const value =
      '{$count :number} items, updated {$year :number useGrouping=never}';
    await saveCatalog(cms, 'volt-ui', 'en', { cart: { items: value } });

    await renameProjectTranslationKey(cms, 'volt-ui', {
      key: 'cart.items',
      newKey: 'cart.summary',
      expectedRevisions: await revisionsOf(cms, ['en']),
    });

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      cart: { summary: value },
    });
  });
});

describe('deleteProjectTranslationKey', () => {
  it('deletes a key present in every locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home', docs: 'Docs' },
    });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    await saveCatalog(cms, 'volt-ui', 'uk', { nav: { home: 'Головна' } });
    const expectedRevisions = await revisionsOf(cms, ['en', 'es', 'uk']);

    const result = await deleteProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.operation).toBe('delete');
    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { docs: 'Docs' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({});
    expect((await getCatalog(cms, 'volt-ui', 'uk')).content).toEqual({});
  });

  it('treats a target locale missing the key as nothing to remove, not an error', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', {});
    const expectedRevisions = await revisionsOf(cms, ['en', 'es']);

    const result = await deleteProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.results.map((entry) => entry.locale)).toEqual(['en']);
  });

  it('handles a configured locale with no catalog at all', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    const expectedRevisions = await revisionsOf(cms, ['en']);

    const result = await deleteProjectTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      expectedRevisions,
    });

    expect(result.saved).toBe(true);
    expect(result.results.map((entry) => entry.locale)).toEqual(['en']);
  });

  it('prunes empty parents left behind by the delete', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', {
      legacy: { banner: { title: 'Old title' } },
    });

    await deleteProjectTranslationKey(cms, 'volt-ui', {
      key: 'legacy.banner.title',
      expectedRevisions: await revisionsOf(cms, ['en']),
    });

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({});
  });

  it('rejects a delete when the key does not exist in the source locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      deleteProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.missing',
        expectedRevisions: await revisionsOf(cms, ['en']),
      }),
    ).rejects.toThrow(TranslationNotFoundError);
  });

  it('rejects a stale revision and deletes nothing', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    const staleRevisions = await revisionsOf(cms, ['en', 'es']);

    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Casa' } });

    await expect(
      deleteProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        expectedRevisions: staleRevisions,
      }),
    ).rejects.toThrow(TranslationLifecycleConflictError);

    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
  });

  it('rejects an unsafe key', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      deleteProjectTranslationKey(cms, 'volt-ui', {
        key: 'nav.__proto__',
        expectedRevisions: await revisionsOf(cms, ['en']),
      }),
    ).rejects.toThrow(InvalidTranslationKeyError);
  });
});
