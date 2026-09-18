import { UniqueConstraintError } from '@forge-cms/runtime';

import type { GlossaCmsRuntime } from '../cms/runtime';
import { DEFAULT_CATALOG_NAMESPACE } from '../domain/catalog';
import {
  mergeProjectInput,
  ProjectValidationError,
  toProject,
  validateProjectInput,
  type Project,
  type ProjectInput,
} from '../domain/project';
import { revokeAllProjectTokens } from './project-token.service';

const PROJECTS_COLLECTION = 'projects';
const CATALOGS_COLLECTION = 'catalogs';

export class ProjectNotFoundError extends Error {
  readonly code = 'PROJECT_NOT_FOUND';

  constructor() {
    super('Project not found');
  }
}

export class ProjectSlugConflictError extends Error {
  readonly code = 'PROJECT_SLUG_CONFLICT';

  constructor() {
    super('Project slug already exists');
  }
}

export class ProjectLocaleConflictError extends Error {
  readonly code = 'PROJECT_LOCALE_CONFLICT';

  constructor() {
    super('Project locales cannot remove a locale with an existing catalog.');
  }
}

/**
 * Once a project has catalogs, its source locale is the canonical key authority for the
 * workspace, analysis and lifecycle — so it may only move to a locale that has a catalog to be
 * canonical *from*. A project with no catalogs yet has nothing to lose and is exempt.
 */
export class ProjectSourceCatalogRequiredError extends Error {
  readonly code = 'PROJECT_SOURCE_CATALOG_REQUIRED';

  constructor(locale: string) {
    super(
      `The source locale cannot be changed to "${locale}" because that locale has no catalog.`,
    );
  }
}

/**
 * Deleting a project is several independent writes (revoke tokens, delete each catalog, delete the
 * project) — Forge/D1 offers no cross-row transaction here and none is faked. This is thrown when
 * one of them fails. The project record is only ever deleted after every owned catalog is gone, so
 * on this error the project **still exists**, but catalogs listed in `deletedCatalogs` are already
 * deleted and tokens are already revoked; retrying the deletion finishes the job.
 */
export class ProjectDeleteIncompleteError extends Error {
  readonly code = 'PROJECT_DELETE_INCOMPLETE';
  readonly project: Project;
  readonly deletedCatalogs: number;

  constructor(project: Project, deletedCatalogs: number, cause: unknown) {
    super(
      `Project was not deleted: the deletion failed part-way. ${deletedCatalogs} catalog(s) were already removed and access tokens may already be revoked. The project record was kept; retry the deletion to finish.`,
      { cause },
    );
    this.project = project;
    this.deletedCatalogs = deletedCatalogs;
  }
}

export type ProjectDeletionResult = {
  /** Snapshot of the project as it was just before deletion (its delivery URLs, for cache purging). */
  project: Project;
  deletedCatalogs: number;
  revokedTokens: number;
};

export async function listProjects(cms: GlossaCmsRuntime): Promise<Project[]> {
  const page = await cms.find({
    collection: PROJECTS_COLLECTION,
    sort: 'name',
    order: 'asc',
  });

  return page.docs.map(toProject);
}

export async function getProjectBySlug(
  cms: GlossaCmsRuntime,
  slug: string,
): Promise<Project> {
  const project = await findProjectBySlug(cms, slug);

  if (!project) {
    throw new ProjectNotFoundError();
  }

  return project;
}

/**
 * Resolves a project by its immutable id rather than slug — used by the machine API, which
 * derives project identity from trusted API-key metadata (`metadata.projectId`), never from a
 * client-supplied slug (see `requireProjectMachineContext`).
 */
export async function getProjectById(
  cms: GlossaCmsRuntime,
  id: string,
): Promise<Project> {
  const page = await cms.find({
    collection: PROJECTS_COLLECTION,
    where: { id },
    limit: 1,
  });

  const [record] = page.docs;

  if (!record) {
    throw new ProjectNotFoundError();
  }

  return toProject(record);
}

export async function createProject(
  cms: GlossaCmsRuntime,
  input: ProjectInput,
): Promise<Project> {
  const project = validateProjectInput(input);
  await assertSlugAvailable(cms, project.slug);

  const record = await normalizeProjectWrite(() =>
    cms.create({
      collection: PROJECTS_COLLECTION,
      data: project,
    }),
  );

  return toProject(record);
}

export async function updateProject(
  cms: GlossaCmsRuntime,
  slug: string,
  input: ProjectInput,
): Promise<Project> {
  const current = await getProjectBySlug(cms, slug);
  const next = mergeProjectInput(current, input);
  await assertSlugAvailable(cms, next.slug, current.id);
  await assertLocalesCanBeRemoved(cms, current, next.locales);
  await assertSourceCatalogAvailable(cms, current, next);

  // Catalog rows are deliberately not touched here: a source-locale change is a metadata change
  // only. Workspace, analysis, the manifests and MCP all derive the source from this record.
  const record = await normalizeProjectWrite(() =>
    cms.update({
      collection: PROJECTS_COLLECTION,
      id: current.id,
      data: next,
    }),
  );

  return toProject(record);
}

/**
 * Deletes a project and everything it owns: its access tokens (revoked), its catalogs (deleted),
 * then the project record — in that order, and the record is never deleted while an owned catalog
 * remains. There is no transaction across these writes; a failure part-way throws
 * `ProjectDeleteIncompleteError` (project kept, some catalogs possibly already gone) rather than
 * pretending to roll back. Tokens are revoked first so a machine writer cannot re-create a catalog
 * mid-deletion. Users, identities, sessions and every other project are untouched.
 */
export async function deleteProject(
  cms: GlossaCmsRuntime,
  slug: string,
): Promise<ProjectDeletionResult> {
  const current = await getProjectBySlug(cms, slug);
  let deletedCatalogs = 0;
  let revokedTokens = 0;

  try {
    revokedTokens = await revokeAllProjectTokens(cms, current.id);

    const catalogs = await cms.find({
      collection: CATALOGS_COLLECTION,
      where: { project: current.id },
    });

    for (const catalog of catalogs.docs) {
      await cms.delete({ collection: CATALOGS_COLLECTION, id: catalog.id });
      deletedCatalogs += 1;
    }

    await assertNoCatalogsRemain(cms, current.id);
    await cms.delete({ collection: PROJECTS_COLLECTION, id: current.id });
  } catch (error) {
    throw new ProjectDeleteIncompleteError(current, deletedCatalogs, error);
  }

  return { project: current, deletedCatalogs, revokedTokens };
}

export function isProjectServiceError(
  error: unknown,
): error is
  | ProjectNotFoundError
  | ProjectSlugConflictError
  | ProjectLocaleConflictError
  | ProjectSourceCatalogRequiredError
  | ProjectDeleteIncompleteError
  | ProjectValidationError {
  return (
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectSlugConflictError ||
    error instanceof ProjectLocaleConflictError ||
    error instanceof ProjectSourceCatalogRequiredError ||
    error instanceof ProjectDeleteIncompleteError ||
    error instanceof ProjectValidationError
  );
}

async function assertSlugAvailable(
  cms: GlossaCmsRuntime,
  slug: string,
  allowedId?: string,
): Promise<void> {
  const existing = await findProjectBySlug(cms, slug);

  if (existing && existing.id !== allowedId) {
    throw new ProjectSlugConflictError();
  }
}

async function findProjectBySlug(
  cms: GlossaCmsRuntime,
  slug: string,
): Promise<Project | null> {
  const page = await cms.find({
    collection: PROJECTS_COLLECTION,
    where: {
      slug,
    },
    limit: 1,
  });

  const [record] = page.docs;
  return record ? toProject(record) : null;
}

async function normalizeProjectWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      error instanceof UniqueConstraintError &&
      error.collection === PROJECTS_COLLECTION &&
      error.fields.includes('slug')
    ) {
      throw new ProjectSlugConflictError();
    }

    throw error;
  }
}

async function assertLocalesCanBeRemoved(
  cms: GlossaCmsRuntime,
  current: Project,
  nextLocales: string[],
): Promise<void> {
  const removedLocales = current.locales.filter(
    (locale) => !nextLocales.includes(locale),
  );

  if (removedLocales.length === 0) {
    return;
  }

  const existing = await cms.count({
    collection: CATALOGS_COLLECTION,
    where: {
      project: current.id,
      locale: { in: removedLocales },
    },
  });

  if (existing > 0) {
    throw new ProjectLocaleConflictError();
  }
}

/**
 * A source-locale change with catalogs present needs a candidate catalog to be canonical from; the
 * candidate's key set may differ from the current source's (that is often the very fix being
 * made), so only its existence is required — never key-set equality.
 */
async function assertSourceCatalogAvailable(
  cms: GlossaCmsRuntime,
  current: Project,
  next: Omit<Project, 'id'>,
): Promise<void> {
  if (current.sourceLocale === next.sourceLocale) {
    return;
  }

  const existing = await cms.count({
    collection: CATALOGS_COLLECTION,
    where: { project: current.id, namespace: DEFAULT_CATALOG_NAMESPACE },
  });

  if (existing === 0) {
    return;
  }

  const candidate = await cms.count({
    collection: CATALOGS_COLLECTION,
    where: {
      project: current.id,
      locale: next.sourceLocale,
      namespace: DEFAULT_CATALOG_NAMESPACE,
    },
  });

  if (candidate === 0) {
    throw new ProjectSourceCatalogRequiredError(next.sourceLocale);
  }
}

/** The invariant behind deletion: the project record is never removed while a catalog still points at it. */
async function assertNoCatalogsRemain(
  cms: GlossaCmsRuntime,
  projectId: string,
): Promise<void> {
  const remaining = await cms.count({
    collection: CATALOGS_COLLECTION,
    where: { project: projectId },
  });

  if (remaining > 0) {
    throw new Error(`${remaining} catalog(s) still exist for this project.`);
  }
}
