import { eventHandler } from 'h3';

import { requireUser } from '../../../http/auth-http';
import { getProjectBySlug } from '../../../services/project.service';
import {
  getProjectSlug,
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      project: await getProjectBySlug(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
