import { setResponseStatus, type H3Event } from 'h3';

import type { GlossaCmsRuntime } from '../cms/runtime';
import { hasCommittedWrite } from '../domain/deploy-hook';
import {
  DeployHookNotFoundError,
  isDeployHookServiceError,
  triggerProjectDeployHook,
} from '../services/deploy-hook.service';
import { getProjectBySlug } from '../services/project.service';
import { runInBackground } from './background';
import { sendProjectError, type ProjectErrorBody } from './project-http';

/**
 * Schedules the project's static-consumer deploy hook after one successful *logical* content
 * change — a route calls this once per operation, never per catalog written, so a rename across
 * three locales or a three-file import is one rebuild, not three. Runs in the background (see
 * `runInBackground`): the response never waits for Cloudflare, and a provider failure is recorded
 * as the hook's last-delivery status instead of failing the change that already succeeded.
 */
export function scheduleProjectDeployHook(
  event: H3Event,
  cms: GlossaCmsRuntime,
  project: { id: string } | { slug: string },
): void {
  runInBackground(
    event,
    (async () => {
      const ref =
        'id' in project ? project : await getProjectBySlug(cms, project.slug);
      await triggerProjectDeployHook(cms, ref);
    })(),
  );
}

/**
 * `scheduleProjectDeployHook` for an operation whose response lists per-catalog results — fires
 * only when at least one catalog was actually written (see `hasCommittedWrite`), so a refused or
 * fully-conflicted write schedules nothing.
 */
export function scheduleDeployHookAfterWrites(
  event: H3Event,
  cms: GlossaCmsRuntime,
  projectSlug: string,
  results: readonly { status: string }[],
): void {
  if (hasCommittedWrite(results)) {
    scheduleProjectDeployHook(event, cms, { slug: projectSlug });
  }
}

export function sendDeployHookError(
  event: H3Event,
  error: unknown,
): ProjectErrorBody {
  if (isDeployHookServiceError(error)) {
    setResponseStatus(
      event,
      error instanceof DeployHookNotFoundError ? 404 : 400,
    );
    return { error: { code: error.code, message: error.message } };
  }

  return sendProjectError(event, error);
}
