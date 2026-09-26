import { eventHandler } from 'h3';

import { requireAdminReadUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { sendDeployHookError } from '../../../../../http/deploy-hook-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { getProjectDeployHookView } from '../../../../../services/deploy-hook.service';
import { getProjectBySlug } from '../../../../../services/project.service';

/**
 * Admin-only: deploy-hook configuration is deployment infrastructure. Returns the masked view only
 * — the stored URL is a credential and never leaves the server after it was saved.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminReadUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));

    return { deployHook: await getProjectDeployHookView(cms, project) };
  } catch (error) {
    return sendDeployHookError(event, error);
  }
});
