import { eventHandler } from 'h3';

import { listCatalogs } from '../../../../../services/catalog.service';
import {
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    const cms = await getRuntimeForEvent(event);

    return {
      catalogs: await listCatalogs(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
