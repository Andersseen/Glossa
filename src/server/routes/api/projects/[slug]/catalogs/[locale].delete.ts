import { eventHandler } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { deleteCatalog } from '../../../../../services/catalog.service';
import {
  getCatalogLocale,
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
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
