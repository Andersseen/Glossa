import { eventHandler } from 'h3';

import { requireUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { sendTranslationError } from '../../../../../http/translation-http';
import { getTranslationAnalysis } from '../../../../../services/translation-analysis.service';

/**
 * Project-wide completeness/diff, in one request — the same `catalogs` read the Workspace already
 * pays for, just compared in-memory instead of rendered as cross-locale entries. Read-only: no
 * mutation, no query parameters, same human auth boundary (`requireUser`) as the Workspace GET —
 * a machine project access token is rejected here exactly like it is there.
 */
export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return await getTranslationAnalysis(cms, getProjectSlug(event));
  } catch (error) {
    return sendTranslationError(event, error);
  }
});
