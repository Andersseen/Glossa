import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { CatalogRevisionConflictError } from './catalog.service';
import {
  CatalogImportReplaceRequiredError,
  CatalogImportValidationError,
  commitCatalogImport,
  previewCatalogImport,
} from './catalog-import.service';
import { getCatalog, saveCatalog } from './catalog.service';
import { createProject } from './project.service';

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
  slug = 'volt-ui',
  locales: string[] = ['en', 'es', 'uk'],
) {
  return createProject(cms, {
    name: 'Volt UI',
    slug,
    sourceLocale: 'en',
    locales,
  });
}

function catalogPayload(locale: string, extra: Record<string, unknown> = {}) {
  return {
    locale,
    content: { nav: { home: 'Home', docs: 'Docs' } },
    ...extra,
  };
}

function largeCatalog(keyCount: number): Record<string, string> {
  const content: Record<string, string> = {};

  for (let i = 0; i < keyCount; i++) {
    content[`key_${i}`] = `Value ${i}`;
  }

  return content;
}

describe('catalog import — preview', () => {
  it('reports new catalogs with a message count and does not write anything', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('es')],
    });

    expect(preview.canImport).toBe(true);
    expect(preview.results).toEqual([
      { locale: 'en', ok: true, status: 'new', messageCount: 2 },
      { locale: 'es', ok: true, status: 'new', messageCount: 2 },
    ]);

    await expect(getCatalog(cms, 'volt-ui', 'en')).rejects.toThrow();
  });

  it('reports an existing catalog with both message counts and its revision', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    const existing = await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home' },
    });

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en')],
    });

    expect(preview.canImport).toBe(true);
    expect(preview.results).toEqual([
      {
        locale: 'en',
        ok: true,
        status: 'existing',
        messageCount: 2,
        existingMessageCount: 1,
        existingRevision: existing.revision,
      },
    ]);
  });

  it('flags an unconfigured locale without failing the whole preview', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'volt-ui', ['en']);

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('fr')],
    });

    expect(preview.canImport).toBe(false);
    expect(preview.results[0]).toMatchObject({ locale: 'en', ok: true });
    expect(preview.results[1]).toMatchObject({
      locale: 'fr',
      ok: false,
      error: { code: 'CATALOG_LOCALE_NOT_CONFIGURED' },
    });
  });

  it('flags every file mapped to a duplicate locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('en')],
    });

    expect(preview.canImport).toBe(false);
    expect(preview.results).toHaveLength(2);
    for (const result of preview.results) {
      expect(result).toMatchObject({
        locale: 'en',
        ok: false,
        error: { code: 'CATALOG_IMPORT_VALIDATION_FAILED' },
      });
    }
  });

  it('flags an invalid catalog root without failing the whole preview', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), { locale: 'es', content: ['nope'] }],
    });

    expect(preview.results[1]).toMatchObject({
      locale: 'es',
      ok: false,
      error: { code: 'CATALOG_VALIDATION_FAILED' },
    });
  });

  it('rejects a batch that is not an array, an empty batch, and an oversized batch', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    await expect(
      previewCatalogImport(cms, 'volt-ui', { catalogs: 'nope' }),
    ).rejects.toBeInstanceOf(CatalogImportValidationError);

    await expect(
      previewCatalogImport(cms, 'volt-ui', { catalogs: [] }),
    ).rejects.toBeInstanceOf(CatalogImportValidationError);

    const tooMany = Array.from({ length: 51 }, (_, i) =>
      catalogPayload(`locale-${i}`),
    );
    await expect(
      previewCatalogImport(cms, 'volt-ui', { catalogs: tooMany }),
    ).rejects.toBeInstanceOf(CatalogImportValidationError);
  });

  it('preserves MessageFormat syntax exactly and counts it as one message', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    const message = '{$count :number useGrouping=never}';

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [{ locale: 'en', content: { count: message } }],
    });

    expect(preview.results[0]).toMatchObject({ ok: true, messageCount: 1 });
  });

  it('handles a synthetic 1,000+ key catalog without trouble', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'volt-ui', ['en']);

    const preview = await previewCatalogImport(cms, 'volt-ui', {
      catalogs: [{ locale: 'en', content: largeCatalog(1200) }],
    });

    expect(preview.canImport).toBe(true);
    expect(preview.results[0]).toMatchObject({ ok: true, messageCount: 1200 });
  });
});

describe('catalog import — commit', () => {
  it('imports multiple new catalogs, each flowing through the normal catalog service', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [
        catalogPayload('en'),
        catalogPayload('es'),
        catalogPayload('uk'),
      ],
    });

    expect(result.imported).toBe(true);
    expect(result.results).toHaveLength(3);
    for (const item of result.results) {
      expect(item).toMatchObject({ status: 'imported', messageCount: 2 });
      if (item.status === 'imported') {
        expect(item.revision).toBeTruthy();
      }
    }

    const en = await getCatalog(cms, 'volt-ui', 'en');
    expect(en.content).toEqual({ nav: { home: 'Home', docs: 'Docs' } });
  });

  it('refuses to replace an existing catalog without explicit confirmation, and writes nothing', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'volt-ui', 'en', { nav: { home: 'Home' } });

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('es')],
    });

    expect(result.imported).toBe(false);
    expect(result.results[0]).toMatchObject({
      locale: 'en',
      status: 'failed',
      error: { code: 'CATALOG_IMPORT_REPLACE_REQUIRED' },
    });
    // The whole batch is refused — the otherwise-valid "es" item is not written either.
    expect(result.results[1]).toMatchObject({
      locale: 'es',
      status: 'failed',
      error: { code: 'CATALOG_IMPORT_NOT_ATTEMPTED' },
    });
    await expect(getCatalog(cms, 'volt-ui', 'es')).rejects.toThrow();

    const preserved = await getCatalog(cms, 'volt-ui', 'en');
    expect(preserved.content).toEqual({ nav: { home: 'Home' } });
  });

  it('replaces an existing catalog when explicitly confirmed with the correct revision', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    const existing = await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home' },
    });

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [
        catalogPayload('en', {
          replaceExisting: true,
          expectedRevision: existing.revision,
        }),
      ],
    });

    expect(result.imported).toBe(true);
    expect(result.results[0]).toMatchObject({ status: 'imported' });

    const updated = await getCatalog(cms, 'volt-ui', 'en');
    expect(updated.content).toEqual({ nav: { home: 'Home', docs: 'Docs' } });
    expect(updated.revision).not.toBe(existing.revision);
  });

  it('rejects a stale revision on replacement and preserves the newer content — concurrency regression', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    const initial = await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Home' },
    });

    // Someone else (human or MCP) updates the catalog after the import preview read `initial`.
    const concurrentEdit = await saveCatalog(cms, 'volt-ui', 'en', {
      nav: { home: 'Inicio' },
    });

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [
        catalogPayload('en', {
          replaceExisting: true,
          expectedRevision: initial.revision,
        }),
      ],
    });

    expect(result.imported).toBe(false);
    expect(result.results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'CATALOG_REVISION_CONFLICT' },
    });

    const preserved = await getCatalog(cms, 'volt-ui', 'en');
    expect(preserved.content).toEqual({ nav: { home: 'Inicio' } });
    expect(preserved.revision).toBe(concurrentEdit.revision);
  });

  it('rejects an unconfigured locale and writes nothing in the batch', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'volt-ui', ['en']);

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('fr')],
    });

    expect(result.imported).toBe(false);
    await expect(getCatalog(cms, 'volt-ui', 'en')).rejects.toThrow();
  });

  it('rejects duplicate locale mappings within one batch and writes nothing', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [catalogPayload('en'), catalogPayload('en')],
    });

    expect(result.imported).toBe(false);
    await expect(getCatalog(cms, 'volt-ui', 'en')).rejects.toThrow();
  });

  it('keeps two projects fully isolated during import', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'project-a', ['en']);
    await setUpProject(cms, 'project-b', ['en']);

    await commitCatalogImport(cms, 'project-a', {
      catalogs: [{ locale: 'en', content: { a: 'Project A' } }],
    });

    await expect(getCatalog(cms, 'project-b', 'en')).rejects.toThrow();
  });

  it('imports a synthetic 1,000+ key catalog', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'volt-ui', ['en']);

    const result = await commitCatalogImport(cms, 'volt-ui', {
      catalogs: [{ locale: 'en', content: largeCatalog(1500) }],
    });

    expect(result.imported).toBe(true);
    expect(result.results[0]).toMatchObject({
      status: 'imported',
      messageCount: 1500,
    });

    const catalog = await getCatalog(cms, 'volt-ui', 'en');
    expect(Object.keys(catalog.content)).toHaveLength(1500);
  });
});

describe('catalog import — error types', () => {
  it('exposes the current revision on a replace-required error', () => {
    const error = new CatalogImportReplaceRequiredError('en', 'rev-1');
    expect(error.code).toBe('CATALOG_IMPORT_REPLACE_REQUIRED');
    expect(error.currentRevision).toBe('rev-1');
  });

  it('exposes the current revision on a revision-conflict error', () => {
    const error = new CatalogRevisionConflictError('rev-2');
    expect(error.code).toBe('CATALOG_REVISION_CONFLICT');
    expect(error.currentRevision).toBe('rev-2');
  });
});
