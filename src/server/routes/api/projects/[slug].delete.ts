import { eventHandler } from 'h3';

import { requireWriteUser } from '../../../http/auth-http';
import { deleteProject } from '../../../services/project.service';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      project: await deleteProject(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
