import { UniqueConstraintError } from '@forge-cms/runtime';

import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
  CatalogRevisionConflictError,
  deleteCatalog,
  getCatalog,
  listCatalogs,
  saveCatalog,
  saveCatalogWithPrecondition,
} from '../../src/server/services/catalog.service';
import {
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjects,
  ProjectDeleteIncompleteError,
  updateProject,
  ProjectLocaleConflictError,
} from '../../src/server/services/project.service';
import { freshRuntime, openRuntime } from './harness';

const en = { greeting: { hello: 'Hello', bye: 'Bye' }, title: 'Title' };

async function seedProject(slug = 'app', locales = ['en', 'es']) {
  const cms = await openRuntime();
  const project = await createProject(cms, {
    name: slug,
    slug,
    sourceLocale: 'en',
    locales,
  });
  return { cms, project };
}

describe('catalog persistence on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('persists a catalog and reads it back through another runtime', async () => {
    const { cms, project } = await seedProject();
    const saved = await saveCatalog(cms, 'app', 'en', en);

    const stored = await getCatalog(await openRuntime(), 'app', 'en');
    expect(stored).toEqual(saved);
    expect(stored).toMatchObject({
      project: project.id,
      locale: 'en',
      content: en,
    });
  });

  it('persists nested JSON updates and advances the revision on each write', async () => {
    const { cms } = await seedProject();
    const first = await saveCatalog(cms, 'app', 'en', en);

    const nextContent = {
      greeting: { hello: 'Hi', bye: 'Bye', deep: { er: 'still nested' } },
    };
    const second = await saveCatalog(
      await openRuntime(),
      'app',
      'en',
      nextContent,
    );

    expect(second.revision).not.toBe(first.revision);
    const stored = await getCatalog(await openRuntime(), 'app', 'en');
    expect(stored.content).toEqual(nextContent);
    expect(stored.revision).toBe(second.revision);
    // An update, not a second row.
    await expect(
      listCatalogs(await openRuntime(), 'app'),
    ).resolves.toHaveLength(1);
  });

  it('lists catalogs per project, ordered by locale', async () => {
    const { cms } = await seedProject('app');
    await createProject(cms, {
      name: 'Other',
      slug: 'other',
      sourceLocale: 'en',
      locales: ['en', 'fr'],
    });
    await saveCatalog(cms, 'app', 'es', { a: 'a' });
    await saveCatalog(cms, 'app', 'en', { a: 'a' });
    await saveCatalog(cms, 'other', 'fr', { a: 'a' });

    const reader = await openRuntime();
    const app = await listCatalogs(reader, 'app');
    expect(app.map((catalog) => catalog.locale)).toEqual(['en', 'es']);
    const other = await listCatalogs(reader, 'other');
    expect(other.map((catalog) => catalog.locale)).toEqual(['fr']);
  });

  it('enforces the (project, locale, namespace) unique index in the database', async () => {
    const { cms, project } = await seedProject();
    const saved = await saveCatalog(cms, 'app', 'en', en);

    // Bypass the service's find-then-write so the index itself is what must refuse the row.
    await expect(
      cms.create({
        collection: 'catalogs',
        data: {
          project: project.id,
          locale: 'en',
          namespace: saved.namespace,
          content: { dup: 'dup' },
          revision: 'dup',
          updatedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);

    await expect(getCatalog(await openRuntime(), 'app', 'en')).resolves.toEqual(
      saved,
    );
  });

  it('rejects writes for an unconfigured locale without persisting anything', async () => {
    const { cms } = await seedProject();

    await expect(saveCatalog(cms, 'app', 'de', en)).rejects.toBeInstanceOf(
      CatalogLocaleNotConfiguredError,
    );
    await expect(listCatalogs(await openRuntime(), 'app')).resolves.toEqual([]);
  });

  it('deletes a catalog for real and leaves siblings alone', async () => {
    const { cms } = await seedProject();
    await saveCatalog(cms, 'app', 'en', en);
    await saveCatalog(cms, 'app', 'es', { title: 'Título' });

    await deleteCatalog(cms, 'app', 'es');

    const reader = await openRuntime();
    await expect(getCatalog(reader, 'app', 'es')).rejects.toBeInstanceOf(
      CatalogNotFoundError,
    );
    await expect(getCatalog(reader, 'app', 'en')).resolves.toMatchObject({
      content: en,
    });
    await expect(deleteCatalog(reader, 'app', 'es')).rejects.toBeInstanceOf(
      CatalogNotFoundError,
    );
  });
});

describe('optimistic concurrency contract on D1 (sequential only)', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  // Sequential contract tests. They do NOT show the check-then-write is atomic: two simultaneous
  // writers holding the same revision can still both pass the read check (known, deferred).
  it('accepts a write with the current revision and rejects a stale one', async () => {
    const { cms } = await seedProject();
    const r1 = await saveCatalogWithPrecondition(
      cms,
      'app',
      'en',
      { v: 'one' },
      {
        ifNoneMatchAny: true,
      },
    );

    const r2 = await saveCatalogWithPrecondition(
      await openRuntime(),
      'app',
      'en',
      { v: 'two' },
      { ifMatch: r1.revision },
    );
    expect(r2.revision).not.toBe(r1.revision);

    const error = await saveCatalogWithPrecondition(
      await openRuntime(),
      'app',
      'en',
      { v: 'stale' },
      { ifMatch: r1.revision },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogRevisionConflictError);
    expect((error as CatalogRevisionConflictError).currentRevision).toBe(
      r2.revision,
    );

    await expect(
      getCatalog(await openRuntime(), 'app', 'en'),
    ).resolves.toMatchObject({
      content: { v: 'two' },
      revision: r2.revision,
    });
  });

  it('rejects create-only and revision-less writes to an existing catalog', async () => {
    const { cms } = await seedProject();
    const saved = await saveCatalog(cms, 'app', 'en', { v: 'one' });

    await expect(
      saveCatalogWithPrecondition(
        cms,
        'app',
        'en',
        { v: 'x' },
        { ifNoneMatchAny: true },
      ),
    ).rejects.toBeInstanceOf(CatalogRevisionConflictError);
    await expect(
      saveCatalogWithPrecondition(cms, 'app', 'en', { v: 'x' }, {}),
    ).rejects.toBeInstanceOf(CatalogRevisionConflictError);

    await expect(getCatalog(await openRuntime(), 'app', 'en')).resolves.toEqual(
      saved,
    );
  });

  it('rejects a conditional write to a catalog that does not exist', async () => {
    const { cms } = await seedProject();

    await expect(
      saveCatalogWithPrecondition(
        cms,
        'app',
        'en',
        { v: 'x' },
        { ifMatch: 'nope' },
      ),
    ).rejects.toMatchObject({ currentRevision: null });
    await expect(listCatalogs(cms, 'app')).resolves.toEqual([]);
  });
});

describe('project/catalog relationships on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('refuses to delete a project row that still owns a catalog', async () => {
    const { cms, project } = await seedProject();
    await saveCatalog(cms, 'app', 'en', en);

    // Raw record delete, not the service: the `restrict` relation must hold at the data layer.
    await expect(
      cms.delete({ collection: 'projects', id: project.id }),
    ).rejects.toThrow();

    await expect(getProjectBySlug(await openRuntime(), 'app')).resolves.toEqual(
      project,
    );
    await expect(
      getCatalog(await openRuntime(), 'app', 'en'),
    ).resolves.toMatchObject({
      project: project.id,
    });
  });

  it('refuses to attach a catalog to a project that does not exist', async () => {
    const cms = await openRuntime();

    await expect(
      cms.create({
        collection: 'catalogs',
        data: {
          project: 'no-such-project',
          locale: 'en',
          namespace: '',
          content: { a: 'a' },
          revision: 'r',
          updatedAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow();
    await expect(cms.count({ collection: 'catalogs' })).resolves.toBe(0);
  });

  it('refuses to drop a locale that has a catalog', async () => {
    const { cms } = await seedProject();
    await saveCatalog(cms, 'app', 'es', { a: 'a' });

    await expect(
      updateProject(cms, 'app', { locales: ['en'] }),
    ).rejects.toBeInstanceOf(ProjectLocaleConflictError);
    await expect(
      getProjectBySlug(await openRuntime(), 'app'),
    ).resolves.toMatchObject({
      locales: ['en', 'es'],
    });
  });

  it('deleting one project removes only its own catalogs', async () => {
    const { cms } = await seedProject('app');
    await createProject(cms, {
      name: 'Keep',
      slug: 'keep',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, 'app', 'en', en);
    await saveCatalog(cms, 'app', 'es', { a: 'a' });
    await saveCatalog(cms, 'keep', 'en', { kept: 'yes' });

    const result = await deleteProject(cms, 'app');
    expect(result).toMatchObject({ deletedCatalogs: 2 });

    const reader = await openRuntime();
    expect((await listProjects(reader)).map((p) => p.slug)).toEqual(['keep']);
    await expect(listCatalogs(reader, 'keep')).resolves.toHaveLength(1);
    await expect(reader.count({ collection: 'catalogs' })).resolves.toBe(1);
  });

  it('reports an incomplete deletion and keeps the project when a catalog delete fails', async () => {
    const { cms, project } = await seedProject();
    await saveCatalog(cms, 'app', 'en', en);
    await saveCatalog(cms, 'app', 'es', { a: 'a' });

    // Deterministic failure injection at the Forge boundary (not D1): the second catalog delete throws.
    const realDelete = cms.delete.bind(cms);
    let catalogDeletes = 0;
    const failing = new Proxy(cms, {
      get(target, prop) {
        if (prop === 'delete') {
          return (args: Parameters<typeof realDelete>[0]) => {
            if (args.collection === 'catalogs' && ++catalogDeletes === 2) {
              return Promise.reject(new Error('injected failure'));
            }
            return realDelete(args);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const error = await deleteProject(failing, 'app').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectDeleteIncompleteError);
    expect((error as ProjectDeleteIncompleteError).deletedCatalogs).toBe(1);

    const reader = await openRuntime();
    await expect(getProjectBySlug(reader, 'app')).resolves.toEqual(project);
    await expect(reader.count({ collection: 'catalogs' })).resolves.toBe(1);

    // Retrying finishes the job.
    await expect(deleteProject(reader, 'app')).resolves.toMatchObject({
      deletedCatalogs: 1,
    });
    await expect(listProjects(await openRuntime())).resolves.toEqual([]);
  });
});
