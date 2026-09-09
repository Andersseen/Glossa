import { eventHandler } from 'h3';

import { requireUser } from '../../../../../http/auth-http';
import { listCatalogs } from '../../../../../services/catalog.service';
import {
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';

export default eventHandler(async (event) => {
  try {
    await requireUser(event);
    const cms = await getRuntimeForEvent(event);

    return {
      catalogs: await listCatalogs(cms, getProjectSlug(event)),
    };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
