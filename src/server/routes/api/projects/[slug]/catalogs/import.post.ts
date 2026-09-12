import { eventHandler, readBody, setResponseStatus } from 'h3';

import { requireWriteUser } from '../../../../../http/auth-http';
import { sendCatalogImportError } from '../../../../../http/catalog-import-http';
import { getProjectSlug } from '../../../../../http/catalog-http';
import { getRuntimeForEvent } from '../../../../../http/project-http';
import { commitCatalogImport } from '../../../../../services/catalog-import.service';

/**
 * Commits a batch of catalog imports. Preflights the whole batch before writing anything — see
 * `commitCatalogImport` — so a malformed or unconfirmed-replacement item never leaves the batch
 * half-written. Returns 200 only when every catalog in the batch was actually imported; 422 with
 * per-item `results` otherwise (validation failure or, rarely, a write-time race).
 */
export default eventHandler(async (event) => {
  try {
    await requireWriteUser(event);
    const cms = await getRuntimeForEvent(event);
    const body = await readBody(event);
    const result = await commitCatalogImport(cms, getProjectSlug(event), body);

    if (!result.imported) {
      setResponseStatus(event, 422);
    }

    return result;
  } catch (error) {
    return sendCatalogImportError(event, error);
  }
});
