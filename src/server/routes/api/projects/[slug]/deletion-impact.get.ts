import { eventHandler } from 'h3';

import { requireAdminReadUser } from '../../../../http/auth-http';
import { getProjectSlug } from '../../../../http/catalog-http';
import {
  getRuntimeForEvent,
  sendProjectError,
} from '../../../../http/project-http';
import { getProjectDeletionImpact } from '../../../../services/project-settings.service';

/**
 * What deleting this project would remove — read-only and admin-only (it reports token counts,
 * which the admin-only token list already exposes), so only someone who could actually delete
 * the project sees it.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminReadUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      impact: await getProjectDeletionImpact(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
