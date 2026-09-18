import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import {
  collections,
  getProjectApiKeyAdapter,
  type GlossaCmsRuntime,
} from '../cms/runtime';
import { DEFAULT_CATALOG_NAMESPACE } from '../domain/catalog';
import { ProjectValidationError } from '../domain/project';
import { getCatalog, listCatalogs, saveCatalog } from './catalog.service';
import { createProjectToken } from './project-token.service';
import {
  createProject,
  deleteProject,
  getProjectById,
  getProjectBySlug,
  listProjects,
  ProjectDeleteIncompleteError,
  ProjectLocaleConflictError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  ProjectSourceCatalogRequiredError,
  updateProject,
} from './project.service';
import { getTranslationAnalysis } from './translation-analysis.service';
import { getTranslationWorkspace } from './translation-workspace.service';

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

describe('project service', () => {
  it('lists, gets, creates, updates and deletes projects', async () => {
    const cms = await createTestRuntime();

    const created = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });

    expect(created).toMatchObject({ name: 'Volt UI', slug: 'volt-ui' });
    await expect(listProjects(cms)).resolves.toHaveLength(1);
    await expect(getProjectBySlug(cms, 'volt-ui')).resolves.toMatchObject({
      sourceLocale: 'en',
    });

    await expect(
      updateProject(cms, 'volt-ui', { name: 'Volt Design System' }),
    ).resolves.toMatchObject({
      name: 'Volt Design System',
      slug: 'volt-ui',
    });

    await expect(deleteProject(cms, 'volt-ui')).resolves.toMatchObject({
      project: { slug: 'volt-ui' },
    });
    await expect(getProjectBySlug(cms, 'volt-ui')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('normalizes database slug uniqueness into a product conflict', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await expect(
      createProject(cms, {
        name: 'Duplicate',
        slug: 'volt-ui',
        sourceLocale: 'en',
        locales: ['en'],
      }),
    ).rejects.toBeInstanceOf(ProjectSlugConflictError);
  });

  it('rejects removing a locale that already has catalog content', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    await saveCatalog(cms, 'volt-ui', 'es', { common: { save: 'Guardar' } });

    await expect(
      updateProject(cms, 'volt-ui', { locales: ['en'] }),
    ).rejects.toBeInstanceOf(ProjectLocaleConflictError);
  });
});

async function setUpProject(
  cms: GlossaCmsRuntime,
  slug: string,
  overrides: { locales?: string[]; publicDelivery?: boolean } = {},
) {
  return createProject(cms, {
    name: `Project ${slug}`,
    slug,
    sourceLocale: 'en',
    locales: overrides.locales ?? ['en', 'es'],
    publicDelivery: overrides.publicDelivery ?? false,
  });
}

describe('changing the source locale', () => {
  it('is allowed for a project with no catalogs yet', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');

    await expect(
      updateProject(cms, 'my-blog', { sourceLocale: 'es' }),
    ).resolves.toMatchObject({ sourceLocale: 'es', locales: ['en', 'es'] });
    await expect(getProjectBySlug(cms, 'my-blog')).resolves.toMatchObject({
      sourceLocale: 'es',
    });
  });

  it('is allowed to a configured locale that has a catalog, even when its keys differ', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A', b: 'B' });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a' });

    await expect(
      updateProject(cms, 'my-blog', { sourceLocale: 'es' }),
    ).resolves.toMatchObject({ sourceLocale: 'es' });
  });

  it('is rejected when catalogs exist but the new source locale has none', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog', { locales: ['en', 'es', 'uk'] });
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a' });

    const attempt = updateProject(cms, 'my-blog', { sourceLocale: 'uk' });

    await expect(attempt).rejects.toBeInstanceOf(
      ProjectSourceCatalogRequiredError,
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_CATALOG_REQUIRED',
      message:
        'The source locale cannot be changed to "uk" because that locale has no catalog.',
    });
    await expect(getProjectBySlug(cms, 'my-blog')).resolves.toMatchObject({
      sourceLocale: 'en',
    });
  });

  it('cannot use a locale added in the same request as a shortcut around the catalog requirement', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });

    await expect(
      updateProject(cms, 'my-blog', {
        locales: ['en', 'es', 'pt'],
        sourceLocale: 'pt',
      }),
    ).rejects.toBeInstanceOf(ProjectSourceCatalogRequiredError);
  });

  it('is rejected as a validation error when the candidate is not a configured locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');

    await expect(
      updateProject(cms, 'my-blog', { sourceLocale: 'fr' }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(getProjectBySlug(cms, 'my-blog')).resolves.toMatchObject({
      sourceLocale: 'en',
    });
  });

  it('does not require a candidate catalog when the source locale is unchanged', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });

    await expect(
      updateProject(cms, 'my-blog', { name: 'Renamed', sourceLocale: 'en' }),
    ).resolves.toMatchObject({ name: 'Renamed', sourceLocale: 'en' });
  });

  it('never rewrites catalog content or advances any catalog revision', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A', nested: { b: 'B' } });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a' });
    const before = await listCatalogs(cms, 'my-blog');

    await updateProject(cms, 'my-blog', { sourceLocale: 'es' });

    await expect(listCatalogs(cms, 'my-blog')).resolves.toEqual(before);
    await expect(getCatalog(cms, 'my-blog', 'en')).resolves.toMatchObject({
      content: { a: 'A', nested: { b: 'B' } },
    });
  });

  it('changes which keys the workspace and analysis treat as canonical', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A', b: 'B' });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a', c: 'c' });

    const beforeWorkspace = await getTranslationWorkspace(cms, 'my-blog');
    expect(beforeWorkspace.entries.map((entry) => entry.key)).toEqual([
      'a',
      'b',
    ]);
    expect(beforeWorkspace.project.sourceLocale).toBe('en');

    await updateProject(cms, 'my-blog', { sourceLocale: 'es' });

    const workspace = await getTranslationWorkspace(cms, 'my-blog');
    expect(workspace.project.sourceLocale).toBe('es');
    expect(workspace.entries.map((entry) => entry.key)).toEqual(['a', 'c']);

    const { analysis } = await getTranslationAnalysis(cms, 'my-blog');
    expect(analysis.sourceLocale).toBe('es');
    expect(analysis.sourceKeys).toBe(2);
    expect(analysis.locales.find((l) => l.locale === 'en')).toMatchObject({
      missingKeys: ['c'],
      extraKeys: ['b'],
    });
  });

  it('keeps the locale-removal protection', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'my-blog');
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a' });

    await expect(
      updateProject(cms, 'my-blog', { sourceLocale: 'es', locales: ['es'] }),
    ).rejects.toBeInstanceOf(ProjectLocaleConflictError);
  });
});

describe('deleting a project', () => {
  it('deletes an empty project', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'empty');

    await expect(deleteProject(cms, 'empty')).resolves.toMatchObject({
      project: { slug: 'empty' },
      deletedCatalogs: 0,
      revokedTokens: 0,
    });
    await expect(getProjectBySlug(cms, 'empty')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('deletes a project that has one catalog', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'one');
    await saveCatalog(cms, 'one', 'en', { a: 'A' });

    await expect(deleteProject(cms, 'one')).resolves.toMatchObject({
      deletedCatalogs: 1,
    });
    await expect(cms.count({ collection: 'catalogs' })).resolves.toBe(0);
    await expect(listProjects(cms)).resolves.toEqual([]);
  });

  it('deletes every catalog of a project that has several', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'many', { locales: ['en', 'es', 'uk'] });
    await saveCatalog(cms, 'many', 'en', { a: 'A' });
    await saveCatalog(cms, 'many', 'es', { a: 'a' });
    await saveCatalog(cms, 'many', 'uk', { a: 'а' });

    await expect(deleteProject(cms, 'many')).resolves.toMatchObject({
      deletedCatalogs: 3,
    });
    await expect(cms.count({ collection: 'catalogs' })).resolves.toBe(0);
  });

  it('deletes a public-delivery project and revokes its active access tokens', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms, 'public', {
      publicDelivery: true,
    });
    await saveCatalog(cms, 'public', 'en', { a: 'A' });
    const { token } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const result = await deleteProject(cms, 'public');

    expect(result).toMatchObject({
      project: { publicDelivery: true },
      deletedCatalogs: 1,
      revokedTokens: 1,
    });
    await expect(getProjectById(cms, project.id)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(
      getProjectApiKeyAdapter(cms).getApiKey(token.id),
    ).resolves.toMatchObject({ revokedAt: expect.any(String) });
  });

  it("leaves every other project's catalogs and tokens untouched", async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms, 'doomed');
    const keeper = await setUpProject(cms, 'keeper');
    await saveCatalog(cms, 'doomed', 'en', { a: 'A' });
    await saveCatalog(cms, 'keeper', 'en', { k: 'K' });
    await saveCatalog(cms, 'keeper', 'es', { k: 'k' });
    const { token } = await createProjectToken(cms, keeper, {
      name: 'Keeper CI',
      scopes: ['catalog:read'],
    });

    await deleteProject(cms, 'doomed');

    await expect(listCatalogs(cms, 'keeper')).resolves.toHaveLength(2);
    await expect(getCatalog(cms, 'keeper', 'en')).resolves.toMatchObject({
      content: { k: 'K' },
    });
    const keeperToken = await getProjectApiKeyAdapter(cms).getApiKey(token.id);
    expect(keeperToken).toBeTruthy();
    expect(keeperToken?.revokedAt).toBeUndefined();
    await expect(getProjectBySlug(cms, 'keeper')).resolves.toMatchObject({
      slug: 'keeper',
    });
  });

  it('keeps the project record when a catalog deletion fails, and reports what already happened', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms, 'flaky', {
      locales: ['en', 'es', 'uk'],
    });
    await saveCatalog(cms, 'flaky', 'en', { a: 'A' });
    await saveCatalog(cms, 'flaky', 'es', { a: 'a' });
    await saveCatalog(cms, 'flaky', 'uk', { a: 'а' });
    const { token } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const realDelete = cms.delete.bind(cms);
    let catalogDeletes = 0;
    const spy = vi.spyOn(cms, 'delete').mockImplementation(((
      args: Parameters<typeof cms.delete>[0],
    ) => {
      if (args.collection === 'catalogs') {
        catalogDeletes += 1;

        if (catalogDeletes === 2) {
          return Promise.reject(new Error('database unavailable'));
        }
      }

      return realDelete(args);
    }) as typeof cms.delete);

    const attempt = deleteProject(cms, 'flaky');

    await expect(attempt).rejects.toBeInstanceOf(ProjectDeleteIncompleteError);
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_DELETE_INCOMPLETE',
      deletedCatalogs: 1,
      project: { slug: 'flaky' },
    });

    // The invariant: no project record is removed while an owned catalog remains. There is no
    // rollback — the one catalog that was deleted stays deleted.
    await expect(getProjectBySlug(cms, 'flaky')).resolves.toMatchObject({
      slug: 'flaky',
    });
    await expect(cms.count({ collection: 'catalogs' })).resolves.toBe(2);
    await expect(
      getProjectApiKeyAdapter(cms).getApiKey(token.id),
    ).resolves.toMatchObject({ revokedAt: expect.any(String) });

    // Retrying finishes the job once the failure clears.
    spy.mockRestore();
    await expect(deleteProject(cms, 'flaky')).resolves.toMatchObject({
      deletedCatalogs: 2,
      revokedTokens: 0,
    });
    await expect(getProjectBySlug(cms, 'flaky')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });

  it('does not delete the project record if a catalog appears after the catalogs were deleted', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms, 'racy');
    await saveCatalog(cms, 'racy', 'en', { a: 'A' });

    const realDelete = cms.delete.bind(cms);
    vi.spyOn(cms, 'delete').mockImplementation((async (
      args: Parameters<typeof cms.delete>[0],
    ) => {
      const deleted = await realDelete(args);

      if (args.collection === 'catalogs') {
        // A writer slips a new catalog in between the catalog deletes and the project delete.
        await cms.create({
          collection: 'catalogs',
          data: {
            project: project.id,
            locale: 'es',
            namespace: DEFAULT_CATALOG_NAMESPACE,
            content: { late: 'write' },
            revision: 'r',
            updatedAt: new Date().toISOString(),
          },
        });
      }

      return deleted;
    }) as typeof cms.delete);

    await expect(deleteProject(cms, 'racy')).rejects.toBeInstanceOf(
      ProjectDeleteIncompleteError,
    );
    await expect(getProjectBySlug(cms, 'racy')).resolves.toMatchObject({
      slug: 'racy',
    });
  });
});
