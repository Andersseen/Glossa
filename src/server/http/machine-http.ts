import type { AuthUser } from '@forge-cms/auth';
import { setResponseStatus, type H3Event } from 'h3';

import type { Project } from '../domain/project';
import { hasCatalogRead, hasCatalogWrite } from '../domain/project-token';
import { getProjectById } from '../services/project.service';
import { toHeaderOnlyRequest } from './auth-http';
import { sendCatalogError, type CatalogErrorBody } from './catalog-http';
import { getRuntimeForEvent, type ProjectErrorBody } from './project-http';
import type { GlossaCmsRuntime } from '../cms/runtime';

export type MachineErrorBody = ProjectErrorBody | CatalogErrorBody;

export type ProjectMachineContext = {
  cms: GlossaCmsRuntime;
  principal: AuthUser;
  projectId: string;
  scopes: string[];
  project: Project;
  canReadCatalog: boolean;
  canWriteCatalog: boolean;
};

/**
 * The stable, small error-code set the machine API promises callers (agents/CI scripts) — never a
 * raw Forge/SQL error, never a stack trace. Distinct from the generic `UNAUTHORIZED`/`FORBIDDEN`
 * Forge's own `ForgeAuthError`/`AccessDeniedError` already produce (reused as-is via
 * `sendCatalogError`'s existing fallback chain) so scope failures are identifiable on their own.
 */
class MachineAuthError extends Error {
  readonly status: number;
  readonly apiCode: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.apiCode = code;
  }
}

/**
 * Authenticates a machine request and resolves the project its token is bound to. Deliberately
 * does *not* stop at `requireAuth()` succeeding — a human cookie/password session authenticates
 * through the very same `CompositeAuthAdapter` and must still be rejected here, because a browser
 * session must never double as a machine API credential. `projectId` is read only from the
 * API key's own trusted `metadata`, never from the URL or request body, so a caller can never
 * point their token at a different project's data.
 */
export async function requireProjectMachineContext(
  event: H3Event,
): Promise<ProjectMachineContext> {
  const cms = await getRuntimeForEvent(event);
  const request = toHeaderOnlyRequest(event);

  const principal = await cms.adapters.auth.requireAuth(request).catch(() => {
    throw new MachineAuthError(401, 'UNAUTHORIZED', 'Unauthorized');
  });

  if (principal.role !== 'machine') {
    throw new MachineAuthError(
      403,
      'FORBIDDEN',
      'This credential is not a project access token.',
    );
  }

  const projectId = principal.metadata?.['projectId'];

  if (typeof projectId !== 'string' || !projectId) {
    throw new MachineAuthError(
      401,
      'UNAUTHORIZED',
      'Token is not bound to a project.',
    );
  }

  const project = await getProjectById(cms, projectId).catch(() => {
    // The token's project no longer resolves (e.g. deleted outside the normal lifecycle path) —
    // treated exactly like an invalid credential rather than leaking that distinction.
    throw new MachineAuthError(401, 'UNAUTHORIZED', 'Unauthorized');
  });

  const scopes = principal.scopes ?? [];

  return {
    cms,
    principal,
    projectId,
    scopes,
    project,
    canReadCatalog: hasCatalogRead(scopes),
    canWriteCatalog: hasCatalogWrite(scopes),
  };
}

export function requireCatalogReadScope(context: ProjectMachineContext): void {
  if (!context.canReadCatalog) {
    throw new MachineAuthError(
      403,
      'INVALID_SCOPE',
      'Token lacks the catalog:read scope.',
    );
  }
}

export function requireCatalogWriteScope(context: ProjectMachineContext): void {
  if (!context.canWriteCatalog) {
    throw new MachineAuthError(
      403,
      'INVALID_SCOPE',
      'Token lacks the catalog:write scope.',
    );
  }
}

export function sendMachineError(
  event: H3Event,
  error: unknown,
): MachineErrorBody {
  if (error instanceof MachineAuthError) {
    setResponseStatus(event, error.status);

    return {
      error: { code: error.apiCode, message: error.message },
    };
  }

  // Reuses the same project/catalog domain-error → status/code mapping the human routes use
  // (CatalogNotFoundError, CatalogLocaleNotConfiguredError, CatalogRevisionConflictError,
  // CatalogValidationError, ProjectNotFoundError, …) — one mapping, not a second one to drift.
  return sendCatalogError(event, error);
}

/** Parses an `If-Match`/`If-None-Match` header value, stripping one layer of `"..."` quoting. */
export function parseEntityTag(
  headerValue: string | undefined,
): string | undefined {
  const trimmed = headerValue?.trim();

  if (!trimmed) {
    return undefined;
  }

  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
      ? trimmed.slice(1, -1)
      : trimmed;

  return unquoted || undefined;
}
