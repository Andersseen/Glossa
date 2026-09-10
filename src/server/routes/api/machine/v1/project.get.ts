import { eventHandler } from 'h3';

import {
  requireProjectMachineContext,
  sendMachineError,
} from '../../../../http/machine-http';

/**
 * The machine API's entry point: given only `GLOSSA_URL` + `GLOSSA_TOKEN`, an agent discovers
 * which project the token is bound to, its locales, and what the token itself may do — no
 * hard-coded project id required.
 */
export default eventHandler(async (event) => {
  try {
    const context = await requireProjectMachineContext(event);
    const { project } = context;

    return {
      data: {
        project: {
          id: project.id,
          slug: project.slug,
          name: project.name,
          sourceLocale: project.sourceLocale,
          locales: project.locales,
        },
        capabilities: {
          catalogRead: context.canReadCatalog,
          catalogWrite: context.canWriteCatalog,
        },
      },
    };
  } catch (error) {
    return sendMachineError(event, error);
  }
});
