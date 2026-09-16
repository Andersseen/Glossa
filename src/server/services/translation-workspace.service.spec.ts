import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { InvalidTranslationKeyError } from '../domain/translation-path';
import { getCatalog, saveCatalog } from './catalog.service';
import { createProject } from './project.service';
import {
  TranslationKeyExistsError,
  TranslationValidationError,
  createTranslationKey,
  getTranslationWorkspace,
  updateTranslationKey,
} from './translation-workspace.service';

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

describe('translation workspace read', () => {
  it('builds a cross-locale workspace from the source locale keys', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home', docs: 'Documentation' },
    });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });

    const workspace = await getTranslationWorkspace(cms, 'volt-ui');

    expect(workspace.project).toEqual({
      slug: 'volt-ui',
      name: 'Volt UI',
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    });
    expect(workspace.entries.map((entry) => entry.key)).toEqual([
      'nav.home',
      'nav.docs',
    ]);
    expect(workspace.summary).toEqual({
      totalKeys: 2,
      completeKeys: 0,
      missingKeys: 2,
    });
    expect(workspace.catalogs['uk']).toEqual({ exists: false });
    expect(workspace.catalogs['en']).toMatchObject({ exists: true });
    expect(workspace.catalogs['en']?.revision).toBeTruthy();
  });

  it('opens with no catalogs at all', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const workspace = await getTranslationWorkspace(cms, 'volt-ui');

    expect(workspace.entries).toEqual([]);
    expect(workspace.summary.totalKeys).toBe(0);
  });

  it('reports target-only keys as a diagnostic without listing them as workspace keys', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', {
      nav: { home: 'Inicio', legacy: 'Antiguo' },
    });

    const workspace = await getTranslationWorkspace(cms, 'volt-ui');

    expect(workspace.entries.map((entry) => entry.key)).toEqual(['nav.home']);
    expect(workspace.diagnostics.targetOnlyKeys).toEqual({ es: 1 });
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      nav: { home: 'Inicio', legacy: 'Antiguo' },
    });
  });
});

describe('translation key update', () => {
  it('updates one target locale and leaves every other value alone', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home', docs: 'Documentation' },
    });
    await saveCatalog(cms, 'volt-ui', 'es', {
      nav: { home: 'Casa', docs: 'Documentación' },
    });
    const esRevision = await revisionOf(cms, 'es');

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        { locale: 'es', value: 'Inicio', expectedRevision: esRevision },
      ],
    });

    expect(result.saved).toBe(true);
    expect(result.results).toEqual([
      { locale: 'es', status: 'saved', revision: expect.any(String) },
    ]);
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      nav: { home: 'Inicio', docs: 'Documentación' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home', docs: 'Documentation' },
    });
    expect(result.entry).toMatchObject({
      key: 'nav.home',
      values: { es: { exists: true, value: 'Inicio' } },
    });
  });

  it('updates several locales in one call and advances each revision', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Casa' } });
    await saveCatalog(cms, 'volt-ui', 'uk', { nav: { home: 'Дім' } });
    const before = {
      es: await revisionOf(cms, 'es'),
      uk: await revisionOf(cms, 'uk'),
    };

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        { locale: 'es', value: 'Inicio', expectedRevision: before.es },
        { locale: 'uk', value: 'Головна', expectedRevision: before.uk },
      ],
    });

    expect(result.saved).toBe(true);
    expect(await revisionOf(cms, 'es')).not.toBe(before.es);
    expect(await revisionOf(cms, 'uk')).not.toBe(before.uk);
    expect(result.entry?.complete).toBe(true);
    expect(result.entry?.translatedCount).toBe(3);
    expect(result.catalogs['uk']?.revision).toBe(await revisionOf(cms, 'uk'));
  });

  it('edits the source locale like any other locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        {
          locale: 'en',
          value: 'Start',
          expectedRevision: await revisionOf(cms, 'en'),
        },
      ],
    });

    expect(result.saved).toBe(true);
    expect(result.entry?.sourceValue).toBe('Start');
  });

  it('creates a configured locale catalog that does not exist yet', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [{ locale: 'uk', value: 'Головна' }],
    });

    expect(result.saved).toBe(true);
    expect((await getCatalog(cms, 'volt-ui', 'uk')).content).toEqual({
      nav: { home: 'Головна' },
    });
  });

  it('writes MessageFormat values verbatim', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { cart: { items: 'items' } });
    const value =
      '{$count :number} artículos de {$year :number useGrouping=never}';

    await updateTranslationKey(cms, 'volt-ui', {
      key: 'cart.items',
      changes: [{ locale: 'es', value }],
    });

    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      cart: { items: value },
    });
  });

  it('stores an empty string as a real value rather than removing the key', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        {
          locale: 'es',
          value: '',
          expectedRevision: await revisionOf(cms, 'es'),
        },
      ],
    });

    expect(result.entry?.values['es']).toEqual({ exists: true, value: '' });
    expect(result.entry?.complete).toBe(true);
  });

  it('rejects an unconfigured locale, a duplicated locale and a non-string value', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      updateTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        changes: [{ locale: 'fr', value: 'Accueil' }],
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);

    await expect(
      updateTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        changes: [
          { locale: 'es', value: 'Inicio' },
          { locale: 'es', value: 'Casa' },
        ],
      }),
    ).rejects.toThrow('appears more than once');

    await expect(
      updateTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        changes: [{ locale: 'es', value: 42 }],
      }),
    ).rejects.toThrow('must be a string');
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects an unsafe "%s" key segment',
    async (segment) => {
      const cms = await createTestRuntime();
      await setUpProject(cms, ['en', 'es']);
      await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

      await expect(
        updateTranslationKey(cms, 'volt-ui', {
          key: `nav.${segment}.home`,
          changes: [{ locale: 'es', value: 'Inicio' }],
        }),
      ).rejects.toBeInstanceOf(InvalidTranslationKeyError);
    },
  );
});

describe('translation workspace concurrency', () => {
  it('rejects a stale save and preserves the newer value', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });

    // The human opens the workspace and holds revision A.
    const workspace = await getTranslationWorkspace(cms, 'volt-ui');
    const revisionA = workspace.catalogs['es']?.revision;
    expect(revisionA).toBeTruthy();

    // Another writer (another human, or an MCP agent through set_translation) moves es to B.
    await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        { locale: 'es', value: 'Portada', expectedRevision: revisionA },
      ],
    });
    const revisionB = await revisionOf(cms, 'es');
    expect(revisionB).not.toBe(revisionA);

    // The first human saves the workspace they opened before that write.
    const stale = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [{ locale: 'es', value: 'Casa', expectedRevision: revisionA }],
    });

    expect(stale.saved).toBe(false);
    expect(stale.results).toEqual([
      {
        locale: 'es',
        status: 'failed',
        error: {
          code: 'CATALOG_REVISION_CONFLICT',
          message: 'Catalog changed since it was read.',
        },
        currentRevision: revisionB,
      },
    ]);
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      nav: { home: 'Portada' },
    });
    expect(await revisionOf(cms, 'es')).toBe(revisionB);
  });

  it('rejects a blind save to an existing catalog', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en', 'es']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [{ locale: 'es', value: 'Casa' }],
    });

    expect(result.saved).toBe(false);
    expect((await getCatalog(cms, 'volt-ui', 'es')).content).toEqual({
      nav: { home: 'Inicio' },
    });
  });

  it('writes nothing at all when one locale in a multi-locale save conflicts', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'volt-ui', 'es', { nav: { home: 'Inicio' } });
    await saveCatalog(cms, 'volt-ui', 'uk', { nav: { home: 'Головна' } });
    const ukRevision = await revisionOf(cms, 'uk');

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'nav.home',
      changes: [
        { locale: 'es', value: 'Casa', expectedRevision: 'stale-revision' },
        { locale: 'uk', value: 'Домівка', expectedRevision: ukRevision },
      ],
    });

    expect(result.saved).toBe(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        locale: 'es',
        status: 'failed',
        error: expect.objectContaining({ code: 'CATALOG_REVISION_CONFLICT' }),
      }),
      expect.objectContaining({
        locale: 'uk',
        status: 'failed',
        error: expect.objectContaining({
          code: 'TRANSLATION_WRITE_NOT_ATTEMPTED',
        }),
      }),
    ]);
    expect((await getCatalog(cms, 'volt-ui', 'uk')).content).toEqual({
      nav: { home: 'Головна' },
    });
    expect(await revisionOf(cms, 'uk')).toBe(ukRevision);
  });
});

describe('translation key creation', () => {
  it('creates the source value and every provided target value', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });
    const workspace = await getTranslationWorkspace(cms, 'volt-ui');

    const result = await createTranslationKey(cms, 'volt-ui', {
      key: 'checkout.payment.title',
      values: { en: 'Payment', es: 'Pago', uk: 'Оплата' },
      expectedRevisions: {
        en: workspace.catalogs['en']?.revision,
      },
    });

    expect(result.saved).toBe(true);
    expect(result.entry).toMatchObject({
      key: 'checkout.payment.title',
      sourceValue: 'Payment',
      translatedCount: 3,
      complete: true,
    });
    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
      checkout: { payment: { title: 'Payment' } },
    });
  });

  it('creates a key with a missing target and reports it as incomplete', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const result = await createTranslationKey(cms, 'volt-ui', {
      key: 'checkout.payment.title',
      values: { en: 'Payment', es: 'Pago', uk: '   ' },
    });

    expect(result.saved).toBe(true);
    expect(result.entry).toMatchObject({
      translatedCount: 2,
      totalLocales: 3,
      complete: false,
    });
    expect(result.entry?.values['uk']).toEqual({ exists: false });

    const workspace = await getTranslationWorkspace(cms, 'volt-ui');
    expect(workspace.summary).toEqual({
      totalKeys: 1,
      completeKeys: 0,
      missingKeys: 1,
    });
  });

  it('requires a source locale value', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: 'checkout.title',
        values: { es: 'Pago' },
      }),
    ).rejects.toThrow('source locale "en" is required');

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: 'checkout.title',
        values: { en: '   ' },
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);
  });

  it('rejects a duplicate source key', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: 'nav.home',
        values: { en: 'Start' },
      }),
    ).rejects.toBeInstanceOf(TranslationKeyExistsError);
    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
  });

  it('rejects an empty key, an empty segment and a prototype-polluting key', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: '   ',
        values: { en: 'Payment' },
      }),
    ).rejects.toBeInstanceOf(TranslationValidationError);

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: 'checkout..title',
        values: { en: 'Payment' },
      }),
    ).rejects.toThrow('empty segment');

    await expect(
      createTranslationKey(cms, 'volt-ui', {
        key: '__proto__.polluted',
        values: { en: 'Payment' },
      }),
    ).rejects.toThrow('disallowed segment');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('rejects a key whose parent is already a translation value', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, ['en']);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const result = await createTranslationKey(cms, 'volt-ui', {
      key: 'nav.home.deep',
      values: { en: 'Deep' },
      expectedRevisions: { en: await revisionOf(cms, 'en') },
    });

    expect(result.saved).toBe(false);
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'INVALID_TRANSLATION_KEY' },
    });
    expect((await getCatalog(cms, 'volt-ui', 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
  });
});

describe('translation workspace at a realistic project size', () => {
  it('builds a 1,000-key, 3-locale workspace in one read and edits one key without touching the rest', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    // Synthetic rather than a copied real catalog: same shape (nested groups, ~1,000 leaves).
    const source: Record<string, Record<string, string>> = {};
    const spanish: Record<string, Record<string, string>> = {};

    for (let group = 0; group < 50; group += 1) {
      const groupKey = `group${group}`;
      source[groupKey] = {};
      spanish[groupKey] = {};

      for (let index = 0; index < 20; index += 1) {
        source[groupKey][`key${index}`] = `Value ${group}.${index}`;

        // Two thirds translated, so the summary has something to split.
        if (index % 3 !== 0) {
          spanish[groupKey][`key${index}`] = `Valor ${group}.${index}`;
        }
      }
    }

    await saveCatalog(cms, 'volt-ui', 'en', source);
    await saveCatalog(cms, 'volt-ui', 'es', spanish);

    const workspace = await getTranslationWorkspace(cms, 'volt-ui');

    expect(workspace.entries).toHaveLength(1000);
    expect(workspace.summary).toEqual({
      totalKeys: 1000,
      completeKeys: 0,
      missingKeys: 1000,
    });
    expect(workspace.catalogs['uk']).toEqual({ exists: false });

    const result = await updateTranslationKey(cms, 'volt-ui', {
      key: 'group7.key3',
      changes: [
        {
          locale: 'es',
          value: 'Valor editado',
          expectedRevision: workspace.catalogs['es']?.revision,
        },
      ],
    });

    expect(result.saved).toBe(true);

    const stored = await getCatalog(cms, 'volt-ui', 'es');
    expect(stored.content['group7']).toMatchObject({
      key1: 'Valor 7.1',
      key2: 'Valor 7.2',
      key3: 'Valor editado',
    });
    expect(Object.keys(stored.content)).toHaveLength(50);
  });
});
