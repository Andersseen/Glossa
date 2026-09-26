import { eventHandler } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { deleteCatalog } from '../../../../../services/catalog.service';
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
    const slug = getProjectSlug(event);
    const catalog = await deleteCatalog(cms, slug, getCatalogLocale(event));

    scheduleProjectDeployHook(event, cms, { slug });

    return { catalog };
  } catch (error) {
    return sendCatalogError(event, error);
  }
});
