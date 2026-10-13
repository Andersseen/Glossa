import { eventHandler } from 'h3';

import { requireAdminUser } from '../../../http/auth-http';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';
import { deleteProject } from '../../../services/project.service';

/**
 * Whole-project deletion — `admin` only, stricter than the `requireWriteUser` (admin/editor) gate
 * the rest of `/api/projects/*` uses; a machine token is rejected by `requireUser` before the
 * role check. The response reports counts only, never catalog content or token secrets.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const { project, deletedCatalogs, revokedTokens, removedDeployHook } =
      await deleteProject(cms, getProjectSlug(event));

    return {
      deleted: true,
      project: { id: project.id, slug: project.slug, name: project.name },
      deletedCatalogs,
      revokedTokens,
      removedDeployHook,
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
