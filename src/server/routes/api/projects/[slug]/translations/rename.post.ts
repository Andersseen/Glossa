import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  sendTranslationLifecycleError,
  setTranslationLifecycleStatus,
} from '../../../../../http/translation-http';
import { renameProjectTranslationKey } from '../../../../../services/translation-lifecycle.service';

/**
 * Renames a canonical source key across every existing project catalog. A dedicated route rather
 * than an action flag on the value-edit PATCH: the request/response shape (a project-wide,
 * all-or-nothing operation with its own preflight) is different enough to be confusing folded in.
 */
export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);

    return setTranslationLifecycleStatus(
      event,
      await renameProjectTranslationKey(cms, getProjectSlug(event), body ?? {}),
    );
  } catch (error) {
    return sendTranslationLifecycleError(event, error);
  }
});
