import { createError, getRequestURL, type H3Event } from 'h3';

/**
 * Public delivery must be revocable: disabling `publicDelivery` or deleting a project has to stop
 * the *next* request from being served. Cloudflare's Cache API is per-data-center and cannot be
 * purged globally, and any shared cache honoring `s-maxage` could keep serving a revoked catalog,
 * so every response (200, 304 and 404) is `no-store` and every request re-checks the project.
 */
export const DELIVERY_CACHE_HEADERS = { 'Cache-Control': 'no-store' } as const;

/**
 * `/i18n/*` is Glossa's one unauthenticated, public surface — deliberately not built
 * on `project-http.ts`/`catalog-http.ts` (those exist for the auth-gated human/machine routes) and
 * deliberately never distinguishing *why* something is 404 (unknown project, delivery disabled,
 * unknown locale, missing catalog all look identical from the outside — see `sendDeliveryNotFound`).
 */
export function getDeliveryProjectSlug(event: H3Event): string {
  return getSegmentAfter(event, 'i18n');
}

export function getDeliveryLocale(event: H3Event): string {
  const segments = getRequestURL(event).pathname.split('/').filter(Boolean);
  const index = segments.indexOf('i18n');
  const raw = index >= 0 ? segments[index + 2] : undefined;

  if (!raw || !raw.endsWith('.json')) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  return decodeURIComponent(raw.slice(0, -'.json'.length));
}

/**
 * Always a plain 404 with no body — an unknown project, a disabled project, an unconfigured
 * locale, and a missing catalog must all be indistinguishable from the outside (see the brief:
 * "Prefer 404 over 403 so project existence is not exposed unnecessarily").
 */
export function sendDeliveryNotFound(): Response {
  return new Response(null, { status: 404, headers: DELIVERY_CACHE_HEADERS });
}

function getSegmentAfter(event: H3Event, marker: string): string {
  const segments = getRequestURL(event).pathname.split('/').filter(Boolean);
  const index = segments.indexOf(marker);
  const value = index >= 0 ? segments[index + 1] : undefined;

  if (!value) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  return decodeURIComponent(value);
}
