import { eventHandler } from 'h3';

import { listProjects } from '../../../services/project.service';
import {
  getRuntimeForEvent,
  sendProjectError,
} from '../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    const cms = await getRuntimeForEvent(event);
    return {
      projects: await listProjects(cms),
    };
  } catch (error) {
    return sendProjectError(event, error);
  }
});
