import { eventHandler } from 'h3';

import { requireUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { sendTranslationError } from '../../../../../http/translation-http';
import { getTranslationWorkspace } from '../../../../../services/translation-workspace.service';

/**
 * The whole workspace in one request — every source key across every configured locale. Search
 * and filtering are client-side, so there is deliberately no query parameter here and no
 * per-key endpoint a UI could accidentally call a thousand times.
 */
export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      workspace: await getTranslationWorkspace(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendTranslationError(event, error);
  }
});
