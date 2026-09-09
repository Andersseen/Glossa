import { eventHandler } from 'h3';

import { requireUser } from '../../../../../http/auth-http';
import { getCatalog } from '../../../../../services/catalog.service';
import {
  getCatalogLocale,
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      catalog: await getCatalog(
        cms,
        getProjectSlug(event),
        getCatalogLocale(event),
      ),
    };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
