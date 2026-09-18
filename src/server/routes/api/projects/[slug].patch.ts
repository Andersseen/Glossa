import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../http/auth-http';
import { updateProject } from '../../../services/project.service';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';
import { purgeProjectDeliveryCache } from '../../../delivery/delivery-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await updateProject(
      cms,
      getProjectSlug(event),
      await readBody(event),
    );

    // A settings change (publicDelivery toggled, locales edited, source locale moved, name
    // changed) can affect what `/i18n/*` should be serving — the manifest carries all of them —
    // so purge rather than wait out the edge cache's own TTL. A disabled project in particular
    // must not keep serving from a stale cache.
    purgeProjectDeliveryCache(event, project);

    return {
      project,
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
