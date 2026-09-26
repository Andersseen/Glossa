import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { scheduleDeployHookAfterWrites } from '../../../../../http/deploy-hook-http';
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
    const slug = getProjectSlug(event);
    const response = await createTranslationKey(cms, slug, body ?? {});

    scheduleDeployHookAfterWrites(event, cms, slug, response.results);

    return setTranslationWriteStatus(event, response, 201);
  } catch (error) {
    return sendTranslationError(event, error);
  }
});
