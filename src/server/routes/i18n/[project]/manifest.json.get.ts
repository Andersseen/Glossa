import { eventHandler, sendWebResponse, toWebRequest, type H3Event } from 'h3';

import {
  getPublicManifest,
  DeliveryDisabledError,
} from '../../../delivery/delivery.service';
import {
  DELIVERY_CACHE_HEADERS,
  getDeliveryProjectSlug,
  sendDeliveryNotFound,
} from '../../../delivery/delivery-http';
import { getRuntimeForEvent } from '../../../http/project-http';
import { ProjectNotFoundError } from '../../../services/project.service';

/**
 * Public, unauthenticated manifest for a project's runtime-delivered catalogs — see
 * `docs/PUBLIC_DELIVERY.md` for the full contract. Never cached server-side or by shared caches:
 * every request re-checks the project's current `publicDelivery` state.
 */
export default eventHandler(async (event) => {
  await sendWebResponse(event, await buildResponse(event, toWebRequest(event)));
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
        ...DELIVERY_CACHE_HEADERS,
      },
    });
  } catch (error) {
    if (
      error instanceof DeliveryDisabledError ||
      error instanceof ProjectNotFoundError
    ) {
      return sendDeliveryNotFound();
    }

    throw error;
  }
}
