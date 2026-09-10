import { createError, getRequestURL, type H3Event } from 'h3';

/**
 * `/i18n/*` is Glossa's one unauthenticated, publicly-cacheable surface — deliberately not built
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
  return new Response(null, { status: 404 });
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
