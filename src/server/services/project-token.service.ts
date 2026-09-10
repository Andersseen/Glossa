import type { ApiKey } from '@forge-cms/auth';

import { getProjectApiKeyAdapter, type GlossaCmsRuntime } from '../cms/runtime';
import type { Project } from '../domain/project';
import {
  PROJECT_TOKEN_SCOPES,
  projectTokenStatus,
  validateCreateProjectTokenInput,
  type CreateProjectTokenInput,
  type ProjectAccessToken,
  type ProjectTokenScope,
} from '../domain/project-token';

export type CreateProjectTokenResult = {
  token: ProjectAccessToken;
  /** Plaintext `glossa_<id>_<secret>` credential — present only in this result, never again. */
  secret: string;
};

export class ProjectTokenNotFoundError extends Error {
  readonly code = 'PROJECT_TOKEN_NOT_FOUND';

  constructor() {
    super('Access token not found');
  }
}

export function isProjectTokenServiceError(
  error: unknown,
): error is ProjectTokenNotFoundError {
  return error instanceof ProjectTokenNotFoundError;
}

export async function createProjectToken(
  cms: GlossaCmsRuntime,
  project: Project,
  input: CreateProjectTokenInput,
): Promise<CreateProjectTokenResult> {
  const validated = validateCreateProjectTokenInput(input);
  const adapter = getProjectApiKeyAdapter(cms);

  const { apiKey, secret } = await adapter.createApiKey({
    name: validated.name,
    scopes: validated.scopes,
    ...(validated.expiresAt ? { expiresAt: validated.expiresAt } : {}),
    // `projectId` is the trusted, immutable authorization key (see machine-http.ts). `projectSlug`
    // is a harmless display snapshot only — never used to decide access.
    metadata: { projectId: project.id, projectSlug: project.slug },
  });

  return { token: toProjectAccessToken(apiKey), secret };
}

/** Only tokens whose trusted `metadata.projectId` matches `project.id` — never a global listing. */
export async function listProjectTokens(
  cms: GlossaCmsRuntime,
  project: Project,
): Promise<ProjectAccessToken[]> {
  const adapter = getProjectApiKeyAdapter(cms);
  const keys = await adapter.listApiKeys();

  return keys
    .filter((key) => belongsToProject(key, project.id))
    .map(toProjectAccessToken)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Revokes a token, first verifying it belongs to `project` — the IDOR guard: an admin on project
 * A must never be able to revoke a token id that turns out to belong to project B, so a mismatch
 * (or missing id) reports the same `ProjectTokenNotFoundError` a genuinely absent id would.
 */
export async function revokeProjectToken(
  cms: GlossaCmsRuntime,
  project: Project,
  tokenId: string,
): Promise<ProjectAccessToken> {
  const adapter = getProjectApiKeyAdapter(cms);
  await requireOwnedToken(adapter, project, tokenId);
  await adapter.revokeApiKey(tokenId);

  const refreshed = await adapter.getApiKey(tokenId);

  if (!refreshed) {
    throw new ProjectTokenNotFoundError();
  }

  return toProjectAccessToken(refreshed);
}

/** Same IDOR guard as `revokeProjectToken` before permanently deleting the key record. */
export async function deleteProjectToken(
  cms: GlossaCmsRuntime,
  project: Project,
  tokenId: string,
): Promise<void> {
  const adapter = getProjectApiKeyAdapter(cms);
  await requireOwnedToken(adapter, project, tokenId);
  await adapter.deleteApiKey(tokenId);
}

/**
 * Revokes every active token bound to `projectId` — called when a project is deleted so a
 * dangling token can never remain usable once its project metadata no longer resolves to
 * anything (spec: machine project deletion lifecycle).
 */
export async function revokeAllProjectTokens(
  cms: GlossaCmsRuntime,
  projectId: string,
): Promise<void> {
  const adapter = getProjectApiKeyAdapter(cms);
  const keys = await adapter.listApiKeys();
  const owned = keys.filter(
    (key) => belongsToProject(key, projectId) && !key.revokedAt,
  );

  await Promise.all(owned.map((key) => adapter.revokeApiKey(key.id)));
}

async function requireOwnedToken(
  adapter: ReturnType<typeof getProjectApiKeyAdapter>,
  project: Project,
  tokenId: string,
): Promise<ApiKey> {
  const key = await adapter.getApiKey(tokenId);

  if (!key || !belongsToProject(key, project.id)) {
    throw new ProjectTokenNotFoundError();
  }

  return key;
}

function belongsToProject(key: ApiKey, projectId: string): boolean {
  return key.metadata?.['projectId'] === projectId;
}

function toProjectAccessToken(key: ApiKey): ProjectAccessToken {
  return {
    id: key.id,
    name: key.name,
    scopes: key.scopes.filter(isProjectTokenScope),
    status: projectTokenStatus(key),
    createdAt: key.createdAt,
    ...(key.expiresAt ? { expiresAt: key.expiresAt } : {}),
    ...(key.revokedAt ? { revokedAt: key.revokedAt } : {}),
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt } : {}),
  };
}

function isProjectTokenScope(scope: string): scope is ProjectTokenScope {
  return (PROJECT_TOKEN_SCOPES as readonly string[]).includes(scope);
}
