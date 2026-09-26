import { UniqueConstraintError } from '@forge-cms/runtime';

import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  parseCloudflareDeployHookUrl,
  parseDeployHookProvider,
  toDeployHook,
  toDeployHookView,
  DeployHookValidationError,
  type DeployHook,
  type DeployHookDeliveryResult,
  type DeployHookFailure,
  type DeployHookView,
} from '../domain/deploy-hook';

const DEPLOY_HOOKS_COLLECTION = 'deploy_hooks';

/** External provider latency must never hang a Glossa request (or a `waitUntil` task) for long. */
export const DEPLOY_HOOK_TIMEOUT_MS = 5_000;

const CLEARED_DELIVERY_STATUS = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatusCode: null,
  lastError: null,
};

export class DeployHookNotFoundError extends Error {
  readonly code = 'DEPLOY_HOOK_NOT_FOUND';

  constructor() {
    super('No deploy hook is configured for this project.');
  }
}

export type DeployHookInput = {
  provider?: unknown;
  url?: unknown;
  enabled?: unknown;
};

export type DeployHookDeliveryOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
};

export type DeployHookTestResult = {
  success: boolean;
  statusCode?: number;
  error?: DeployHookFailure;
  attemptedAt: string;
};

export type DeployHookTriggerResult =
  | { status: 'skipped'; reason: 'not_configured' | 'disabled' }
  | ({ status: 'attempted'; attemptedAt: string } & DeployHookDeliveryResult);

type ProjectRef = { id: string };

export function isDeployHookServiceError(
  error: unknown,
): error is DeployHookNotFoundError | DeployHookValidationError {
  return (
    error instanceof DeployHookNotFoundError ||
    error instanceof DeployHookValidationError
  );
}

export async function getProjectDeployHookView(
  cms: GlossaCmsRuntime,
  project: ProjectRef,
): Promise<DeployHookView> {
  return toDeployHookView(await findDeployHook(cms, project.id));
}

/**
 * Creates or updates the project's single hook. Creating requires a URL; once configured, `url` is
 * optional — `{ enabled: false }` toggles without the admin ever re-sending (or the server ever
 * re-sending) the secret. A replaced URL resets the last-delivery status, which described the old
 * endpoint. Never calls the hook: configuring is not a content change.
 */
export async function configureProjectDeployHook(
  cms: GlossaCmsRuntime,
  project: ProjectRef,
  input: DeployHookInput,
  options: Pick<DeployHookDeliveryOptions, 'now'> = {},
): Promise<DeployHookView> {
  const provider = parseDeployHookProvider(input.provider);
  const url =
    input.url === undefined
      ? undefined
      : parseCloudflareDeployHookUrl(input.url);
  const enabled = readEnabled(input.enabled);
  const now = (options.now?.() ?? new Date()).toISOString();
  const existing = await findDeployHook(cms, project.id);

  if (!existing) {
    if (!url) {
      throw new DeployHookValidationError('A deploy hook URL is required.');
    }

    const data = {
      project: project.id,
      provider,
      url,
      enabled: enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await cms.create({ collection: DEPLOY_HOOKS_COLLECTION, data });
    } catch (error) {
      // Two admins configuring at once: the unique `project` index let exactly one create win, so
      // this request becomes an update of that row rather than a second hook.
      if (!(error instanceof UniqueConstraintError)) {
        throw error;
      }

      const winner = await findDeployHook(cms, project.id);

      if (!winner) {
        throw error;
      }

      await updateHook(cms, winner.id, {
        ...data,
        ...CLEARED_DELIVERY_STATUS,
        createdAt: winner.createdAt,
      });
    }

    return getProjectDeployHookView(cms, project);
  }

  await updateHook(cms, existing.id, {
    provider,
    updatedAt: now,
    ...(enabled === undefined ? {} : { enabled }),
    ...(url && url !== existing.url ? { url, ...CLEARED_DELIVERY_STATUS } : {}),
  });

  return getProjectDeployHookView(cms, project);
}

/** Removes only the hook configuration — never the project, its catalogs, or its tokens. */
export async function removeProjectDeployHook(
  cms: GlossaCmsRuntime,
  project: ProjectRef,
): Promise<{ removed: boolean }> {
  const existing = await findDeployHook(cms, project.id);

  if (!existing) {
    return { removed: false };
  }

  await cms.delete({ collection: DEPLOY_HOOKS_COLLECTION, id: existing.id });
  return { removed: true };
}

/**
 * Explicit admin test: POSTs the hook now (enabled or not — the admin asked) and waits for the
 * provider's answer. Records the attempt exactly like an automatic trigger does.
 */
export async function testProjectDeployHook(
  cms: GlossaCmsRuntime,
  project: ProjectRef,
  options: DeployHookDeliveryOptions = {},
): Promise<DeployHookTestResult> {
  const hook = await findDeployHook(cms, project.id);

  if (!hook) {
    throw new DeployHookNotFoundError();
  }

  const { attemptedAt, result } = await deliverAndRecord(cms, hook, options);

  return {
    success: result.success,
    ...(result.statusCode === undefined
      ? {}
      : { statusCode: result.statusCode }),
    ...(result.success ? {} : { error: result.error }),
    attemptedAt,
  };
}

/**
 * The automatic path, run once per successful logical content change. No hook or a disabled hook is
 * a silent no-op; otherwise the outcome is recorded as last-delivery status. Never throws — a
 * provider (or bookkeeping) failure must not surface as a failure of the change that caused it.
 */
export async function triggerProjectDeployHook(
  cms: GlossaCmsRuntime,
  project: ProjectRef,
  options: DeployHookDeliveryOptions = {},
): Promise<DeployHookTriggerResult> {
  const hook = await findDeployHook(cms, project.id);

  if (!hook) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  if (!hook.enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const { attemptedAt, result } = await deliverAndRecord(cms, hook, options);
  return { status: 'attempted', attemptedAt, ...result };
}

/**
 * Removes a project's hook as part of whole-project deletion (see `deleteProject`). Returns how
 * many rows were removed; the hook is not called.
 */
export async function deleteDeployHookForProject(
  cms: GlossaCmsRuntime,
  projectId: string,
): Promise<number> {
  const existing = await findDeployHook(cms, projectId);

  if (!existing) {
    return 0;
  }

  await cms.delete({ collection: DEPLOY_HOOKS_COLLECTION, id: existing.id });
  return 1;
}

/**
 * One `POST` to the hook URL — no body, no Glossa/Cloudflare credential, no translation content:
 * the URL already is the credential. Redirects are not followed (a 3xx is a failure), so the
 * validated host is the only host ever contacted. The response body is discarded unread; only the
 * status code is kept. Any 2xx is success.
 */
export async function deliverDeployHook(
  url: string,
  options: DeployHookDeliveryOptions = {},
): Promise<DeployHookDeliveryResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEPLOY_HOOK_TIMEOUT_MS,
  );

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
    });

    await response.body?.cancel().catch(() => undefined);

    return response.status >= 200 && response.status < 300
      ? { success: true, statusCode: response.status }
      : { success: false, statusCode: response.status, error: 'http_error' };
  } catch {
    return {
      success: false,
      error: controller.signal.aborted ? 'timeout' : 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverAndRecord(
  cms: GlossaCmsRuntime,
  hook: DeployHook,
  options: DeployHookDeliveryOptions,
): Promise<{ attemptedAt: string; result: DeployHookDeliveryResult }> {
  const attemptedAt = (options.now?.() ?? new Date()).toISOString();
  const result = await deliverDeployHook(hook.url, options);

  try {
    await updateHook(cms, hook.id, {
      lastAttemptAt: attemptedAt,
      lastStatusCode: result.statusCode ?? null,
      ...(result.success
        ? { lastSuccessAt: attemptedAt, lastError: null }
        : { lastError: result.error }),
    });
  } catch {
    // The hook may have been removed (or its project deleted) while the request was in flight;
    // the delivery already happened, and there is nothing left to record it on.
  }

  return { attemptedAt, result };
}

async function findDeployHook(
  cms: GlossaCmsRuntime,
  projectId: string,
): Promise<DeployHook | null> {
  const record = await cms.findOne({
    collection: DEPLOY_HOOKS_COLLECTION,
    where: { project: projectId },
  });

  return record ? toDeployHook(record) : null;
}

async function updateHook(
  cms: GlossaCmsRuntime,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await cms.update({
    collection: DEPLOY_HOOKS_COLLECTION,
    id,
    data: data as never,
  });
}

function readEnabled(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new DeployHookValidationError('"enabled" must be true or false.');
  }

  return value;
}
