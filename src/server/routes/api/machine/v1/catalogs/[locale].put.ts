import { eventHandler, getHeader, readBody, setHeader } from 'h3';

import { getCatalogLocale } from '../../../../../http/catalog-http';
import {
  parseEntityTag,
  requireCatalogWriteScope,
  requireProjectMachineContext,
  sendMachineError,
} from '../../../../../http/machine-http';
import {
  CatalogRevisionConflictError,
  saveCatalogWithPrecondition,
} from '../../../../../services/catalog.service';

/**
 * Optimistic concurrency uses standard HTTP preconditions, not a body field: send `If-Match:
 * "<revision>"` from the last read to update an existing catalog, or `If-None-Match: *` (or no
 * precondition header at all) to create a new one. A stale/missing precondition on an existing
 * catalog is refused — see `saveCatalogWithPrecondition` — so a blind write can never silently
 * clobber a newer human or machine edit.
 */
export default eventHandler(async (event) => {
  try {
    const context = await requireProjectMachineContext(event);
    requireCatalogWriteScope(context);

    const body = await readBody(event);
    const ifMatch = parseEntityTag(getHeader(event, 'if-match'));
    const ifNoneMatchAny =
      parseEntityTag(getHeader(event, 'if-none-match')) === '*';

    const catalog = await saveCatalogWithPrecondition(
      context.cms,
      context.project.slug,
      getCatalogLocale(event),
      body?.content,
      { ifMatch, ifNoneMatchAny },
    );

    setHeader(event, 'ETag', `"${catalog.revision}"`);

    return {
      data: {
        locale: catalog.locale,
        namespace: catalog.namespace,
        content: catalog.content,
        revision: catalog.revision,
        updatedAt: catalog.updatedAt,
      },
    };
  } catch (error) {
    if (
      error instanceof CatalogRevisionConflictError &&
      error.currentRevision
    ) {
      setHeader(event, 'ETag', `"${error.currentRevision}"`);
    }

    return sendMachineError(event, error);
  }
});
