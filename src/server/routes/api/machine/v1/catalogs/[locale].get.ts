import { eventHandler, setHeader } from 'h3';

import { getCatalogLocale } from '../../../../../http/catalog-http';
import {
  requireCatalogReadScope,
  requireProjectMachineContext,
  sendMachineError,
} from '../../../../../http/machine-http';
import { getCatalog } from '../../../../../services/catalog.service';

export default eventHandler(async (event) => {
  try {
    const context = await requireProjectMachineContext(event);
    requireCatalogReadScope(context);

    const catalog = await getCatalog(
      context.cms,
      context.project.slug,
      getCatalogLocale(event),
    );

    // Mirrored in the body too (`revision`) so an agent never has to parse a response header.
    setHeader(event, 'ETag', `"${catalog.revision}"`);

    return {
      data: {
        locale: catalog.locale,
        namespace: catalog.namespace,
        content: catalog.content,
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
      },
    };
  } catch (error) {
    return sendMachineError(event, error);
  }
});
