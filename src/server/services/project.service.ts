import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  mergeProjectInput,
  ProjectValidationError,
  toProject,
  validateProjectInput,
  type Project,
  type ProjectInput,
} from '../domain/project';

const PROJECTS_COLLECTION = 'projects';

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

export async function createProject(
  cms: GlossaCmsRuntime,
  input: ProjectInput,
): Promise<Project> {
  const project = validateProjectInput(input);
  await assertSlugAvailable(cms, project.slug);

  const record = await cms.create({
    collection: PROJECTS_COLLECTION,
    data: project,
  });

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

  const record = await cms.update({
    collection: PROJECTS_COLLECTION,
    id: current.id,
    data: next,
  });

  return toProject(record);
}

export async function deleteProject(
  cms: GlossaCmsRuntime,
  slug: string,
): Promise<Project> {
  const current = await getProjectBySlug(cms, slug);
  const record = await cms.delete({
    collection: PROJECTS_COLLECTION,
    id: current.id,
  });

  return toProject(record);
}

export function isProjectServiceError(
  error: unknown,
): error is
  ProjectNotFoundError | ProjectSlugConflictError | ProjectValidationError {
  return (
    error instanceof ProjectNotFoundError ||
    error instanceof ProjectSlugConflictError ||
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
