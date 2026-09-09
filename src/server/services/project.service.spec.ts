import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { saveCatalog } from './catalog.service';
import {
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjects,
  ProjectDeleteRestrictedError,
  ProjectLocaleConflictError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  updateProject,
} from './project.service';

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
      slug: 'volt-ui',
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

  it('restricts project deletion while catalogs exist', async () => {
    const cms = await createTestRuntime();
    await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, 'volt-ui', 'en', { common: { save: 'Save' } });

    await expect(deleteProject(cms, 'volt-ui')).rejects.toBeInstanceOf(
      ProjectDeleteRestrictedError,
    );
    await expect(getProjectBySlug(cms, 'volt-ui')).resolves.toMatchObject({
      slug: 'volt-ui',
    });
  });
});
