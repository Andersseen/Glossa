import { eventHandler } from 'h3';

import { requireAdminReadUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { sendProjectTokenError } from '../../../../../http/project-token-http';
import { getProjectBySlug } from '../../../../../services/project.service';
import { listProjectTokens } from '../../../../../services/project-token.service';

export default eventHandler(async (event) => {
  try {
    await requireAdminReadUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));

    return {
      tokens: await listProjectTokens(cms, project),
    };
  } catch (error) {
    return sendProjectTokenError(event, error);
  }
});
