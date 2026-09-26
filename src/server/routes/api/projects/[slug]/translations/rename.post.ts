import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { scheduleDeployHookAfterWrites } from '../../../../../http/deploy-hook-http';
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
    const slug = getProjectSlug(event);
    const response = await renameProjectTranslationKey(cms, slug, body ?? {});

    // Project-wide across every catalog, but one logical operation → one rebuild.
    scheduleDeployHookAfterWrites(event, cms, slug, response.results);

    return setTranslationLifecycleStatus(event, response);
  } catch (error) {
    return sendTranslationLifecycleError(event, error);
  }
});
