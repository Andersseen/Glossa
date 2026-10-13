import { ProjectValidationError } from '../../src/server/domain/project';
import {
  createProject,
  getProjectBySlug,
  listProjects,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  updateProject,
} from '../../src/server/services/project.service';
import { assertD1Adapter, freshRuntime, openRuntime } from './harness';

const input = {
  name: 'Volt UI',
  slug: 'volt-ui',
  sourceLocale: 'en',
  locales: ['en', 'es'],
};

describe('project persistence on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('runs on the D1 adapter, not the in-memory one', async () => {
    assertD1Adapter(await openRuntime());
  });

  it('starts from an empty, freshly synced schema', async () => {
    await expect(listProjects(await openRuntime())).resolves.toEqual([]);
  });

  it('persists a project across independently created runtimes', async () => {
    const writer = await openRuntime();
    const created = await createProject(writer, input);

    const reader = await openRuntime();
    expect(reader).not.toBe(writer);
    await expect(getProjectBySlug(reader, 'volt-ui')).resolves.toEqual(created);
  });

  it('persists settings updates for a runtime that did not make them', async () => {
    const writer = await openRuntime();
    const created = await createProject(writer, input);

    await updateProject(writer, 'volt-ui', {
      name: 'Volt Design System',
      locales: ['en', 'es', 'fr'],
      publicDelivery: true,
    });

    await expect(
      getProjectBySlug(await openRuntime(), 'volt-ui'),
    ).resolves.toEqual({
      ...created,
      name: 'Volt Design System',
      locales: ['en', 'es', 'fr'],
      publicDelivery: true,
    });
  });

  it('enforces slug uniqueness and leaves the original project intact', async () => {
    const cms = await openRuntime();
    const original = await createProject(cms, input);

    await expect(
      createProject(await openRuntime(), { ...input, name: 'Impostor' }),
    ).rejects.toBeInstanceOf(ProjectSlugConflictError);

    await createProject(cms, { ...input, name: 'Other', slug: 'other' });
    await expect(
      updateProject(cms, 'other', { slug: 'volt-ui' }),
    ).rejects.toBeInstanceOf(ProjectSlugConflictError);

    const reader = await openRuntime();
    await expect(getProjectBySlug(reader, 'volt-ui')).resolves.toEqual(
      original,
    );
    await expect(getProjectBySlug(reader, 'other')).resolves.toMatchObject({
      name: 'Other',
    });
    await expect(listProjects(reader)).resolves.toHaveLength(2);
  });

  it('does not corrupt data when invalid operations are rejected', async () => {
    const cms = await openRuntime();
    const original = await createProject(cms, input);

    await expect(
      createProject(cms, { ...input, slug: 'Not Kebab' }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(
      updateProject(cms, 'volt-ui', { sourceLocale: 'de' }),
    ).rejects.toBeInstanceOf(ProjectValidationError);
    await expect(
      updateProject(cms, 'missing', { name: 'Nope' }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);

    const reader = await openRuntime();
    await expect(getProjectBySlug(reader, 'volt-ui')).resolves.toEqual(
      original,
    );
    await expect(listProjects(reader)).resolves.toHaveLength(1);
  });
});
