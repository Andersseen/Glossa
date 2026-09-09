import { eventHandler } from 'h3';

import { requireUser } from '../../../http/auth-http';
import { listProjects } from '../../../services/project.service';
import {
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);
    return {
      projects: await listProjects(cms),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
