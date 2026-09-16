import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  sendTranslationError,
  setTranslationWriteStatus,
} from '../../../../../http/translation-http';
import { updateTranslationKey } from '../../../../../services/translation-workspace.service';

/** One key, only the locales that actually changed — never a whole catalog from the workspace. */
export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);

    return setTranslationWriteStatus(
      event,
      await updateTranslationKey(cms, getProjectSlug(event), body ?? {}),
    );
  } catch (error) {
    return sendTranslationError(event, error);
  }
});
