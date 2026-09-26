import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { saveCatalog } from '../../../../../services/catalog.service';
import {
  getCatalogLocale,
  getProjectSlug,
  sendCatalogError,
} from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { scheduleProjectDeployHook } from '../../../../../http/deploy-hook-http';

export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);
    const slug = getProjectSlug(event);
    const catalog = await saveCatalog(
      cms,
      slug,
      getCatalogLocale(event),
      body?.content,
    );

    scheduleProjectDeployHook(event, cms, { slug });

    return { catalog };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
