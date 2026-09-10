import { eventHandler } from 'h3';

import { listCatalogs } from '../../../../../services/catalog.service';
import {
  requireCatalogReadScope,
  requireProjectMachineContext,
  sendMachineError,
} from '../../../../../http/machine-http';

export default eventHandler(async (event) => {
  try {
    const context = await requireProjectMachineContext(event);
    requireCatalogReadScope(context);

    const catalogs = await listCatalogs(context.cms, context.project.slug);

    return {
      data: catalogs.map((catalog) => ({
        locale: catalog.locale,
        namespace: catalog.namespace,
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
      })),
    };
  } catch (error) {
    return sendMachineError(event, error);
  }
});
