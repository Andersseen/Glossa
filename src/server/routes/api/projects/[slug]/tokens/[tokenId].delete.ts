import { eventHandler } from 'h3';

import { requireAdminUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import {
  getTokenId,
  sendProjectTokenError,
} from '../../../../../http/project-token-http';
import { getProjectBySlug } from '../../../../../services/project.service';
import { deleteProjectToken } from '../../../../../services/project-token.service';

export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));
    await deleteProjectToken(cms, project, getTokenId(event));

    return { ok: true };
  } catch (error) {
    return sendProjectTokenError(event, error);
  }
});
