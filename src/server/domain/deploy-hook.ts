/**
 * Static-consumer deploy hooks: one Cloudflare deploy-hook URL per project that Glossa POSTs to
 * after a logical translation change, so a static site (Astro SSG, …) rebuilds with fresh catalogs.
 *
 * The URL itself is the credential — anyone holding it can trigger a build — so this module is the
 * single place that decides which URLs are acceptable (an SSRF allowlist, not a denylist) and how
 * one is shown back to a human (a non-reversible mask).
 */

export const DEPLOY_HOOK_PROVIDERS = ['cloudflare'] as const;
export type DeployHookProvider = (typeof DEPLOY_HOOK_PROVIDERS)[number];

/** Safe, fixed failure categories — never a provider response body, stack trace, or the URL. */
export type DeployHookFailure = 'http_error' | 'network_error' | 'timeout';

export type DeployHook = {
  id: string;
  projectId: string;
  provider: DeployHookProvider;
  /** The secret. Server-only: never serialized into any response, log line, or error. */
  url: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatusCode: number | null;
  lastError: DeployHookFailure | null;
};

/** The only shape a deploy hook ever leaves the server in. */
export type DeployHookView =
  | { configured: false }
  | {
      configured: true;
      provider: DeployHookProvider;
      enabled: boolean;
      urlPreview: string;
      createdAt: string;
      updatedAt: string;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastStatusCode: number | null;
      lastError: DeployHookFailure | null;
    };

export type DeployHookDeliveryResult =
  | { success: true; statusCode: number }
  | { success: false; statusCode?: number; error: DeployHookFailure };

export class DeployHookValidationError extends Error {
  readonly code = 'DEPLOY_HOOK_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

const CLOUDFLARE_API_HOST = 'api.cloudflare.com';
const DEPLOY_HOOKS_SEGMENT = 'deploy_hooks';
const HOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_URL_LENGTH = 512;
const PREVIEW_SUFFIX_LENGTH = 4;

/**
 * Accepts only a Cloudflare deploy-hook endpoint and returns it normalized. Deliberately an
 * allowlist: `https:` + exactly `api.cloudflare.com` + default port, no credentials, query or
 * fragment, a `/client/v4/…/deploy_hooks/<id>` path ending in one opaque identifier. That covers
 * both current shapes —
 *
 *   Pages:          https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<id>
 *   Workers Builds: https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<id>
 *
 * — without pinning one exact product path, while an IP literal, `localhost`, another domain, or a
 * Cloudflare API path that is not a deploy hook can never become a server-side fetch target.
 */
export function parseCloudflareDeployHookUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new DeployHookValidationError('A deploy hook URL is required.');
  }

  const raw = input.trim();

  if (raw.length > MAX_URL_LENGTH) {
    throw new DeployHookValidationError('The deploy hook URL is too long.');
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new DeployHookValidationError('The deploy hook URL is not a URL.');
  }

  if (url.protocol !== 'https:') {
    throw new DeployHookValidationError('The deploy hook URL must use https.');
  }

  if (url.username || url.password) {
    throw new DeployHookValidationError(
      'The deploy hook URL must not contain credentials.',
    );
  }

  // `URL` lowercases the host and strips a default `:443`, so an exact comparison also rejects
  // IP literals (`127.0.0.1`, `[::1]`), `localhost`, look-alike subdomains, and explicit ports.
  if (url.hostname !== CLOUDFLARE_API_HOST || url.port) {
    throw new DeployHookValidationError(
      `The deploy hook URL must be a Cloudflare deploy hook on ${CLOUDFLARE_API_HOST}.`,
    );
  }

  if (url.search || url.hash || raw.includes('#') || raw.includes('?')) {
    throw new DeployHookValidationError(
      'The deploy hook URL must not contain a query string or fragment.',
    );
  }

  const segments = url.pathname.split('/');
  // A leading slash yields an empty first segment; any other empty segment means `//` or a
  // trailing slash, neither of which a Cloudflare-issued hook URL has.
  const [, client, version, ...rest] = segments;
  const hookId = rest.at(-1);

  if (
    client !== 'client' ||
    version !== 'v4' ||
    rest.length < 2 ||
    rest.some((segment) => !segment) ||
    rest.at(-2) !== DEPLOY_HOOKS_SEGMENT ||
    !hookId ||
    !HOOK_ID_PATTERN.test(hookId)
  ) {
    throw new DeployHookValidationError(
      'The URL is not a Cloudflare deploy hook (expected …/deploy_hooks/<id>).',
    );
  }

  return url.toString();
}

export function parseDeployHookProvider(input: unknown): DeployHookProvider {
  if (input === undefined || input === 'cloudflare') {
    return 'cloudflare';
  }

  throw new DeployHookValidationError(
    'Only Cloudflare deploy hooks are supported.',
  );
}

/**
 * `https://api.cloudflare.com/client/v4/…/deploy_hooks/••••••a1b2` — the product path is not
 * secret, the identifier is. Only its last few characters survive, so the original can never be
 * reconstructed from what an admin (or anything the preview leaks into) sees.
 */
export function maskDeployHookUrl(url: string): string {
  const hookId = url.split('/').at(-1) ?? '';
  const suffix =
    hookId.length > PREVIEW_SUFFIX_LENGTH * 2
      ? hookId.slice(-PREVIEW_SUFFIX_LENGTH)
      : '';

  return `https://${CLOUDFLARE_API_HOST}/…/${DEPLOY_HOOKS_SEGMENT}/••••••${suffix}`;
}

export function toDeployHookView(hook: DeployHook | null): DeployHookView {
  if (!hook) {
    return { configured: false };
  }

  return {
    configured: true,
    provider: hook.provider,
    enabled: hook.enabled,
    urlPreview: maskDeployHookUrl(hook.url),
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    lastAttemptAt: hook.lastAttemptAt,
    lastSuccessAt: hook.lastSuccessAt,
    lastStatusCode: hook.lastStatusCode,
    lastError: hook.lastError,
  };
}

export type DeployHookRecord = {
  id: unknown;
  project: unknown;
  provider?: unknown;
  url?: unknown;
  enabled?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastAttemptAt?: unknown;
  lastSuccessAt?: unknown;
  lastStatusCode?: unknown;
  lastError?: unknown;
};

export function toDeployHook(record: DeployHookRecord): DeployHook {
  return {
    id: String(record.id),
    projectId: readRelationId(record.project),
    provider: 'cloudflare',
    url: typeof record.url === 'string' ? record.url : '',
    enabled: record.enabled === true || record.enabled === 1,
    createdAt: readString(record.createdAt) ?? '',
    updatedAt: readString(record.updatedAt) ?? '',
    lastAttemptAt: readString(record.lastAttemptAt),
    lastSuccessAt: readString(record.lastSuccessAt),
    lastStatusCode:
      typeof record.lastStatusCode === 'number' ? record.lastStatusCode : null,
    lastError: readFailure(record.lastError),
  };
}

/**
 * Whether a logical operation's per-catalog results include at least one committed write — the
 * signal that published content actually changed and a static consumer needs a rebuild. A clean
 * preflight refusal writes nothing and so triggers nothing; a rare part-way race still changed
 * what is served, so it does.
 */
export function hasCommittedWrite(
  results: readonly { status: string }[],
): boolean {
  return results.some(
    (result) => result.status === 'saved' || result.status === 'imported',
  );
}

function readRelationId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'id' in value) {
    return String((value as { id: unknown }).id);
  }

  return '';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readFailure(value: unknown): DeployHookFailure | null {
  return value === 'http_error' ||
    value === 'network_error' ||
    value === 'timeout'
    ? value
    : null;
}
