import { eventHandler, readBody, setResponseStatus } from 'h3';

import { requireAdminUser } from '../../../../../http/auth-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { sendProjectTokenError } from '../../../../../http/project-token-http';
import { getProjectBySlug } from '../../../../../services/project.service';
import { createProjectToken } from '../../../../../services/project-token.service';

/**
 * Returns the plaintext secret exactly once, alongside the same safe metadata `GET .../tokens`
 * returns — the UI must show and copy it now; it is never retrievable again.
 */
export default eventHandler(async (event) => {
  try {
    await requireAdminUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await getProjectBySlug(cms, getProjectSlug(event));
    const { token, secret } = await createProjectToken(
      cms,
      project,
      await readBody(event),
    );
    setResponseStatus(event, 201);

    return { token, secret };
  } catch (error) {
    return sendProjectTokenError(event, error);
  }
});
