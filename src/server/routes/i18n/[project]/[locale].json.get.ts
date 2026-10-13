import { eventHandler, getHeader, sendWebResponse, type H3Event } from 'h3';

import {
  getPublicCatalog,
  DeliveryDisabledError,
} from '../../../delivery/delivery.service';
import {
  DELIVERY_CACHE_HEADERS,
  getDeliveryLocale,
  getDeliveryProjectSlug,
  sendDeliveryNotFound,
} from '../../../delivery/delivery-http';
import { getRuntimeForEvent } from '../../../http/project-http';
import { parseEntityTag } from '../../../http/machine-http';
import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
} from '../../../services/catalog.service';
import { ProjectNotFoundError } from '../../../services/project.service';

/**
 * Same contract as the manifest route — see `docs/PUBLIC_DELIVERY.md`. The project and catalog are
 * resolved on every request; `If-None-Match` is only evaluated against a response that already
 * passed those checks, so a disabled or deleted project is `404` even for a previously valid ETag.
 */
export default eventHandler(async (event) => {
  await sendWebResponse(
    event,
    applyConditionalGet(event, await buildResponse(event)),
  );
});

async function buildResponse(event: H3Event): Promise<Response> {
  try {
    const projectSlug = getDeliveryProjectSlug(event);
    const locale = getDeliveryLocale(event);
    const cms = await getRuntimeForEvent(event);
    const catalog = await getPublicCatalog(cms, projectSlug, locale);

    return Response.json(catalog.content, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        ...DELIVERY_CACHE_HEADERS,
        ETag: `"${catalog.revision}"`,
      },
    });
  } catch (error) {
    if (
      error instanceof DeliveryDisabledError ||
      error instanceof ProjectNotFoundError ||
      error instanceof CatalogNotFoundError ||
      error instanceof CatalogLocaleNotConfiguredError
    ) {
      return sendDeliveryNotFound();
    }

    throw error;
  }
}

/** Honors `If-None-Match` against the response's own `ETag`, after availability checks passed. */
function applyConditionalGet(event: H3Event, response: Response): Response {
  const etag = response.headers.get('ETag');
  const ifNoneMatch = parseEntityTag(getHeader(event, 'if-none-match'));

  if (!etag || !ifNoneMatch || parseEntityTag(etag) !== ifNoneMatch) {
    return response;
  }

  const notModified = new Response(null, {
    status: 304,
    headers: DELIVERY_CACHE_HEADERS,
  });
  notModified.headers.set('ETag', etag);
  notModified.headers.set(
    'Access-Control-Allow-Origin',
    response.headers.get('Access-Control-Allow-Origin') ?? '*',
  );

  return notModified;
}
