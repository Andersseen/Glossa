import { eventHandler } from 'h3';

import { requireAdminUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { sendDeployHookError } from '../../../../../http/deploy-hook-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  getProjectDeployHookView,
  removeProjectDeployHook,
} from '../../../../../services/deploy-hook.service';
import { getProjectBySlug } from '../../../../../services/project.service';

/** Removes only the hook configuration — the project, its catalogs and tokens are untouched. */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));
    const { removed } = await removeProjectDeployHook(cms, project);

    return {
      removed,
      deployHook: await getProjectDeployHookView(cms, project),
    };
  } catch (error) {
    return sendDeployHookError(event, error);
  }
});
