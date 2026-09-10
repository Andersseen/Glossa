import {
  eventHandler,
  getHeader,
  sendWebResponse,
  toWebRequest,
  type H3Event,
} from 'h3';

import {
  getPublicCatalog,
  DeliveryDisabledError,
} from '../../../delivery/delivery.service';
import {
  getDeliveryLocale,
  getDeliveryProjectSlug,
} from '../../../delivery/delivery-http';
import { readEdgeCache, writeEdgeCache } from '../../../delivery/edge-cache';
import { getRuntimeForEvent } from '../../../http/project-http';
import { parseEntityTag } from '../../../http/machine-http';
import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
} from '../../../services/catalog.service';
import { ProjectNotFoundError } from '../../../services/project.service';

/** Same bounded-staleness contract as the manifest route — see `docs/PUBLIC_DELIVERY.md`. */
const EDGE_TTL_SECONDS = 30;

export default eventHandler(async (event) => {
  const request = toWebRequest(event);
  const cached = await readEdgeCache(request);

  if (cached) {
    await sendWebResponse(event, applyConditionalGet(event, cached));
    return;
  }

  const response = await buildResponse(event);
  writeEdgeCache(event, request, response.clone());
  await sendWebResponse(event, applyConditionalGet(event, response));
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
        'Cache-Control': `public, max-age=0, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=${EDGE_TTL_SECONDS}`,
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
      return new Response(null, { status: 404 });
    }

    throw error;
  }
}

/** Honors `If-None-Match` against the response's own `ETag`, whether freshly computed or served from the edge cache. */
function applyConditionalGet(event: H3Event, response: Response): Response {
  const etag = response.headers.get('ETag');
  const ifNoneMatch = parseEntityTag(getHeader(event, 'if-none-match'));

  if (!etag || !ifNoneMatch || parseEntityTag(etag) !== ifNoneMatch) {
    return response;
  }

  const notModified = new Response(null, { status: 304 });
  notModified.headers.set('ETag', etag);
  notModified.headers.set(
    'Access-Control-Allow-Origin',
    response.headers.get('Access-Control-Allow-Origin') ?? '*',
  );

  return notModified;
}
