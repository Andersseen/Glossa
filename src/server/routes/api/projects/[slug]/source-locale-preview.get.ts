import { eventHandler, getQuery } from 'h3';

import { requireUser } from '../../../../http/auth-http';
import { getProjectSlug } from '../../../../http/catalog-http';
import {
  getRuntimeForEvent,
  sendProjectError,
} from '../../../../http/project-http';
import { previewSourceLocaleChange } from '../../../../services/project-settings.service';

/**
 * Read-only preview of how moving the source locale to `?locale=` would change the canonical key
 * set. No writes, same human auth boundary (`requireUser`) as the other project reads.
 */
export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      preview: await previewSourceLocaleChange(
        cms,
        getProjectSlug(event),
        getQuery(event)['locale'],
      ),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
