import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../http/auth-http';
import { updateProject } from '../../../services/project.service';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const project = await updateProject(
      cms,
      getProjectSlug(event),
      await readBody(event),
    );

    return {
      project,
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
