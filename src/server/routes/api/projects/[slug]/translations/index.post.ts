import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  sendTranslationError,
  setTranslationWriteStatus,
} from '../../../../../http/translation-http';
import { createTranslationKey } from '../../../../../services/translation-workspace.service';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);

    return setTranslationWriteStatus(
      event,
      await createTranslationKey(cms, getProjectSlug(event), body ?? {}),
      201,
    );
  } catch (error) {
    return sendTranslationError(event, error);
  }
});
