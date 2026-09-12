import { eventHandler, readBody } from 'h3';

import { requireWriteUser } from '../../../../../../http/auth-http';
import { sendCatalogImportError } from '../../../../../../http/catalog-import-http';
import { getProjectSlug } from '../../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../../http/project-http';
import { previewCatalogImport } from '../../../../../../services/catalog-import.service';

/**
 * Read-only: validates a candidate import batch and reports, per file, whether it would create a
 * new catalog or replace an existing one, plus a leaf-message count — nothing is written. The
 * commit route (`import.post.ts`) re-validates independently rather than trusting this response,
 * since a catalog can change between preview and commit.
 */
export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);

    return await previewCatalogImport(cms, getProjectSlug(event), body);
  } catch (error) {
    return sendCatalogImportError(event, error);
  }
});
