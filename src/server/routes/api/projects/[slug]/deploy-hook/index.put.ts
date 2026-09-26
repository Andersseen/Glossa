import { eventHandler, readBody } from 'h3';

import { requireAdminUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { sendDeployHookError } from '../../../../../http/deploy-hook-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { configureProjectDeployHook } from '../../../../../services/deploy-hook.service';
import { getProjectBySlug } from '../../../../../services/project.service';

/**
 * Creates or updates the project's single deploy hook (`{ url, enabled?, provider? }`, or just
 * `{ enabled }` once configured). The project comes from the URL only — a body `project`/`projectId`
 * is ignored. Configuring never calls the hook.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));
    const body = (await readBody(event)) ?? {};

    return {
      deployHook: await configureProjectDeployHook(cms, project, {
        provider: body.provider,
        url: body.url,
        enabled: body.enabled,
      }),
    };
  } catch (error) {
    return sendDeployHookError(event, error);
  }
});
