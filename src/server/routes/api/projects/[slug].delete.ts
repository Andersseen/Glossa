import { eventHandler } from 'h3';

import { purgeProjectDeliveryCache } from '../../../delivery/delivery-http';
import { requireAdminUser } from '../../../http/auth-http';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';
import {
  deleteProject,
  ProjectDeleteIncompleteError,
} from '../../../services/project.service';

/**
 * Whole-project deletion — `admin` only, stricter than the `requireWriteUser` (admin/editor) gate
 * the rest of `/api/projects/*` uses; a machine token is rejected by `requireUser` before the
 * role check. The response reports counts only, never catalog content or token secrets.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const { project, deletedCatalogs, revokedTokens } = await deleteProject(
      cms,
      getProjectSlug(event),
    );

    // The project's public URLs must stop serving now, not when the edge TTL lapses.
    purgeProjectDeliveryCache(event, project);

    return {
      deleted: true,
      project: { id: project.id, slug: project.slug, name: project.name },
      deletedCatalogs,
      revokedTokens,
    };
  } catch (error) {
    if (error instanceof ProjectDeleteIncompleteError) {
      // Some catalogs may already be gone — cached copies of them must not outlive that either.
      purgeProjectDeliveryCache(event, error.project);
    }

    return sendProjectError(event, error);
  }
});
