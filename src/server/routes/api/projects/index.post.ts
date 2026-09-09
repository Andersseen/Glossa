import { eventHandler, readBody, setResponseStatus } from 'h3';

import { requireWriteUser } from '../../../http/auth-http';
import { createProject } from '../../../services/project.service';
import {
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await createProject(cms, await readBody(event));
    setResponseStatus(event, 201);

    return {
      project,
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
