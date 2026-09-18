import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { ProjectValidationError } from '../domain/project';
import { listCatalogs, saveCatalog } from './catalog.service';
import {
  getProjectDeletionImpact,
  previewSourceLocaleChange,
} from './project-settings.service';
import {
  createProjectToken,
  revokeProjectToken,
} from './project-token.service';
import { createProject, ProjectNotFoundError } from './project.service';

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
  locales = ['en', 'es', 'uk'],
) {
  return createProject(cms, {
    name: 'My Blog',
    slug: 'my-blog',
    sourceLocale: 'en',
    locales,
    publicDelivery: true,
  });
}

describe('previewSourceLocaleChange', () => {
  it('reports no structural impact when both catalogs have the same key shape', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, 'my-blog', 'es', { nav: { home: 'Inicio' } });

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'es'),
    ).resolves.toEqual({
      currentSourceLocale: 'en',
      nextSourceLocale: 'es',
      changed: true,
      hasCatalogs: true,
      currentSourceCatalogExists: true,
      nextSourceCatalogExists: true,
      canChange: true,
      currentSourceKeys: 1,
      nextSourceKeys: 1,
      addedCanonicalKeys: [],
      removedCanonicalKeys: [],
    });
  });

  it('reports keys that would become canonical and keys that would stop being canonical', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', {
      nav: { home: 'Home', docs: 'Docs' },
      legacy: 'Old',
    });
    await saveCatalog(cms, 'my-blog', 'es', {
      nav: { home: 'Inicio' },
      footer: 'Pie',
    });

    const preview = await previewSourceLocaleChange(cms, 'my-blog', 'es');

    expect(preview).toMatchObject({
      currentSourceKeys: 3,
      nextSourceKeys: 2,
      addedCanonicalKeys: ['footer'],
      removedCanonicalKeys: ['nav.docs', 'legacy'],
      canChange: true,
    });
  });

  it('is deterministic and does not touch any catalog', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { z: 'z', a: 'a', m: 'm' });
    await saveCatalog(cms, 'my-blog', 'es', { q: 'q', a: 'a' });
    const before = await listCatalogs(cms, 'my-blog');

    const first = await previewSourceLocaleChange(cms, 'my-blog', 'es');
    const second = await previewSourceLocaleChange(cms, 'my-blog', 'es');

    expect(first.removedCanonicalKeys).toEqual(['z', 'm']);
    expect(first.addedCanonicalKeys).toEqual(['q']);
    expect(second).toEqual(first);
    await expect(listCatalogs(cms, 'my-blog')).resolves.toEqual(before);
  });

  it('treats an existing but empty candidate catalog as allowed, with every current key dropped', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A', b: 'B' });
    await saveCatalog(cms, 'my-blog', 'es', {});

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'es'),
    ).resolves.toMatchObject({
      nextSourceCatalogExists: true,
      canChange: true,
      nextSourceKeys: 0,
      removedCanonicalKeys: ['a', 'b'],
      addedCanonicalKeys: [],
    });
  });

  it('flags a missing candidate catalog as not changeable when other catalogs exist', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'uk'),
    ).resolves.toMatchObject({
      hasCatalogs: true,
      nextSourceCatalogExists: false,
      canChange: false,
      removedCanonicalKeys: ['a'],
    });
  });

  it('allows any configured candidate while the project has no catalogs at all', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'es'),
    ).resolves.toMatchObject({
      hasCatalogs: false,
      currentSourceCatalogExists: false,
      nextSourceCatalogExists: false,
      canChange: true,
      currentSourceKeys: 0,
      nextSourceKeys: 0,
    });
  });

  it('reports the current source locale as an unchanged no-op', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'en'),
    ).resolves.toMatchObject({
      changed: false,
      canChange: true,
      addedCanonicalKeys: [],
      removedCanonicalKeys: [],
    });
  });

  it.each([undefined, '', '   ', ['es'], 42])(
    'rejects a missing or malformed candidate (%j)',
    async (candidate) => {
      const cms = await createTestRuntime();
      await setUpProject(cms);

      await expect(
        previewSourceLocaleChange(cms, 'my-blog', candidate),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    },
  );

  it('rejects a candidate that is not a configured locale', async () => {
    const cms = await createTestRuntime();
    await setUpProject(cms);

    await expect(
      previewSourceLocaleChange(cms, 'my-blog', 'fr'),
    ).rejects.toMatchObject({
      message: 'Locale "fr" is not configured for this project.',
    });
  });

  it('rejects an unknown project', async () => {
    const cms = await createTestRuntime();

    await expect(
      previewSourceLocaleChange(cms, 'nope', 'es'),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});

describe('getProjectDeletionImpact', () => {
  it('reports factual counts for what deletion would remove', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms);
    await saveCatalog(cms, 'my-blog', 'en', { a: 'A' });
    await saveCatalog(cms, 'my-blog', 'es', { a: 'a' });
    await createProjectToken(cms, project, {
      name: 'Active',
      scopes: ['catalog:read'],
    });
    const revoked = await createProjectToken(cms, project, {
      name: 'Old',
      scopes: ['catalog:read'],
    });
    await revokeProjectToken(cms, project, revoked.token.id);

    await expect(getProjectDeletionImpact(cms, 'my-blog')).resolves.toEqual({
      project: { id: project.id, slug: 'my-blog', name: 'My Blog' },
      locales: ['en', 'es', 'uk'],
      catalogLocales: ['en', 'es'],
      catalogs: 2,
      accessTokens: { total: 2, active: 1 },
      publicDelivery: true,
    });
  });

  it('never includes a token secret', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms);
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:write'],
    });

    const impact = await getProjectDeletionImpact(cms, 'my-blog');

    expect(JSON.stringify(impact)).not.toContain(secret);
    expect(JSON.stringify(impact)).not.toContain('glossa_');
  });

  it('counts only this project’s tokens and catalogs', async () => {
    const cms = await createTestRuntime();
    const project = await setUpProject(cms);
    const other = await createProject(cms, {
      name: 'Other',
      slug: 'other',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, 'other', 'en', { x: 'X' });
    await createProjectToken(cms, other, {
      name: 'Other CI',
      scopes: ['catalog:read'],
    });

    await expect(
      getProjectDeletionImpact(cms, 'my-blog'),
    ).resolves.toMatchObject({
      project: { id: project.id },
      catalogs: 0,
      accessTokens: { total: 0, active: 0 },
    });
  });

  it('rejects an unknown project', async () => {
    const cms = await createTestRuntime();

    await expect(getProjectDeletionImpact(cms, 'nope')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});
