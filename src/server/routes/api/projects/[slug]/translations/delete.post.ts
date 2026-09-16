import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  sendTranslationLifecycleError,
  setTranslationLifecycleStatus,
} from '../../../../../http/translation-http';
import { deleteProjectTranslationKey } from '../../../../../services/translation-lifecycle.service';

/**
 * Deletes a canonical source key from every existing project catalog. `POST` rather than `DELETE`:
 * the request needs a body (`key` plus `expectedRevisions`), which a `DELETE` body is awkward for
 * across clients/proxies — the same reasoning the milestone brief calls out.
 */
export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);

    return setTranslationLifecycleStatus(
      event,
      await deleteProjectTranslationKey(cms, getProjectSlug(event), body ?? {}),
    );
  } catch (error) {
    return sendTranslationLifecycleError(event, error);
  }
});
