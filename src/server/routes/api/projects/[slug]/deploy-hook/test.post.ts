import { eventHandler } from 'h3';

import { requireAdminUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { sendDeployHookError } from '../../../../../http/deploy-hook-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  getProjectDeployHookView,
  testProjectDeployHook,
} from '../../../../../services/deploy-hook.service';
import { getProjectBySlug } from '../../../../../services/project.service';

/**
 * An explicit, admin-requested delivery: unlike the automatic background trigger, this waits for
 * Cloudflare's answer (bounded by the delivery timeout) and reports it. A failed delivery is still
 * a `200` — the test ran; `success` says how it went. Only the status code and a safe error
 * category come back, never the URL or the provider's response body.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));
    const result = await testProjectDeployHook(cms, project);

    return {
      ...result,
      deployHook: await getProjectDeployHookView(cms, project),
    };
  } catch (error) {
    return sendDeployHookError(event, error);
  }
});
