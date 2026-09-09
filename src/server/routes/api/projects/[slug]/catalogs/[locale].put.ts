import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { saveCatalog } from '../../../../../services/catalog.service';
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
    const body = await readBody(event);

    return {
      catalog: await saveCatalog(
        cms,
        getProjectSlug(event),
        getCatalogLocale(event),
        body?.content,
      ),
    };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
