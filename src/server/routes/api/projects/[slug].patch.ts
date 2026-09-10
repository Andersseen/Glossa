import { eventHandler, getRequestURL, readBody } from 'h3';

import { requireWriteUser } from '../../../http/auth-http';
import { updateProject } from '../../../services/project.service';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';
import { getDeliveryUrls } from '../../../delivery/delivery.service';
import { purgeEdgeCache } from '../../../delivery/edge-cache';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await updateProject(
      cms,
      getProjectSlug(event),
      await readBody(event),
    );

    // A settings change (publicDelivery toggled, locales edited) can affect what `/i18n/*`
    // should be serving — purge rather than wait out the edge cache's own TTL, since the brief
    // specifically calls out that a disabled project must not keep serving from a stale cache.
    purgeEdgeCache(
      event,
      getDeliveryUrls(getRequestURL(event).origin, project),
    );

    return {
      project,
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
