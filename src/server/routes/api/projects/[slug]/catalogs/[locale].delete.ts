import { eventHandler } from 'h3';

import { deleteCatalog } from '../../../../../services/catalog.service';
import {
  getCatalogLocale,
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    const cms = await getRuntimeForEvent(event);

    return {
      catalog: await deleteCatalog(
        cms,
        getProjectSlug(event),
        getCatalogLocale(event),
      ),
    };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
