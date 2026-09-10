/**
 * Machine scope contract for project access tokens: `catalog:write` always implies
 * `catalog:read` — a write-capable token is stored with both scopes so authorization can do a
 * plain `hasScope`/`hasAnyScope` check (see `@forge-cms/auth`) instead of custom "implies" logic
 * at request time.
 */
export const PROJECT_TOKEN_SCOPES = ['catalog:read', 'catalog:write'] as const;

export type ProjectTokenScope = (typeof PROJECT_TOKEN_SCOPES)[number];

export type ProjectTokenStatus = 'active' | 'revoked' | 'expired';

export type ProjectAccessToken = {
  id: string;
  name: string;
  scopes: ProjectTokenScope[];
  status: ProjectTokenStatus;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

export type CreateProjectTokenInput = {
  name?: unknown;
  scopes?: unknown;
  expiresAt?: unknown;
};

export type ValidatedCreateProjectTokenInput = {
  name: string;
  scopes: ProjectTokenScope[];
  expiresAt?: string;
};

export class ProjectTokenValidationError extends Error {
  readonly code = 'PROJECT_TOKEN_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

const MAX_NAME_LENGTH = 120;

export function validateCreateProjectTokenInput(
  input: CreateProjectTokenInput,
): ValidatedCreateProjectTokenInput {
  const name = requireName(input.name);
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = validateExpiresAt(input.expiresAt);

  return {
    name,
    scopes,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function hasCatalogRead(scopes: readonly string[]): boolean {
  return scopes.includes('catalog:read') || scopes.includes('catalog:write');
}

export function hasCatalogWrite(scopes: readonly string[]): boolean {
  return scopes.includes('catalog:write');
}

export function projectTokenStatus(token: {
  revokedAt?: string;
  expiresAt?: string;
}): ProjectTokenStatus {
  if (token.revokedAt) {
    return 'revoked';
  }

  if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }

  return 'active';
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProjectTokenValidationError('Token name is required.');
  }

  const trimmed = value.trim();

  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ProjectTokenValidationError(
      `Token name must be ${MAX_NAME_LENGTH} characters or fewer.`,
    );
  }

  return trimmed;
}

function normalizeScopes(value: unknown): ProjectTokenScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProjectTokenValidationError('At least one scope is required.');
  }

  const requested = new Set<string>();

  for (const raw of value) {
    if (
      typeof raw !== 'string' ||
      !(PROJECT_TOKEN_SCOPES as readonly string[]).includes(raw)
    ) {
      throw new ProjectTokenValidationError(
        `Unknown scope "${typeof raw === 'string' ? raw : String(raw)}".`,
      );
    }

    requested.add(raw);
  }

  if (requested.has('catalog:write')) {
    requested.add('catalog:read');
  }

  return PROJECT_TOKEN_SCOPES.filter((scope) => requested.has(scope));
}

function validateExpiresAt(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || !value.trim()) {
    throw new ProjectTokenValidationError(
      'expiresAt must be an ISO date string.',
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ProjectTokenValidationError('expiresAt is not a valid date.');
  }

  if (parsed.getTime() <= Date.now()) {
    throw new ProjectTokenValidationError('expiresAt must be in the future.');
  }

  return parsed.toISOString();
}
