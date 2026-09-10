import { eventHandler, sendWebResponse, toWebRequest, type H3Event } from 'h3';

import {
  getPublicManifest,
  DeliveryDisabledError,
} from '../../../delivery/delivery.service';
import { getDeliveryProjectSlug } from '../../../delivery/delivery-http';
import { readEdgeCache, writeEdgeCache } from '../../../delivery/edge-cache';
import { getRuntimeForEvent } from '../../../http/project-http';
import { ProjectNotFoundError } from '../../../services/project.service';

/**
 * Public, unauthenticated manifest for a project's runtime-delivered catalogs — see
 * `docs/PUBLIC_DELIVERY.md` for the full contract. Bounded edge staleness of `EDGE_TTL_SECONDS`
 * applies equally to a fresh write becoming visible and to delivery being disabled taking effect.
 */
const EDGE_TTL_SECONDS = 30;

export default eventHandler(async (event) => {
  const request = toWebRequest(event);
  const cached = await readEdgeCache(request);

  if (cached) {
    await sendWebResponse(event, cached);
    return;
  }

  const response = await buildResponse(event, request);
  writeEdgeCache(event, request, response.clone());
  await sendWebResponse(event, response);
});

async function buildResponse(
  event: H3Event,
  request: Request,
): Promise<Response> {
  try {
    const projectSlug = getDeliveryProjectSlug(event);
    const cms = await getRuntimeForEvent(event);
    const manifest = await getPublicManifest(
      cms,
      projectSlug,
      new URL(request.url).origin,
    );

    return Response.json(manifest, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, max-age=0, s-maxage=${EDGE_TTL_SECONDS}, stale-while-revalidate=${EDGE_TTL_SECONDS}`,
      },
    });
  } catch (error) {
    if (
      error instanceof DeliveryDisabledError ||
      error instanceof ProjectNotFoundError
    ) {
      return new Response(null, { status: 404 });
    }

    throw error;
  }
}
