import type { H3Event } from 'h3';

/**
 * Wraps Cloudflare's `caches.default` Cache API for the two public `/i18n/*` routes only. A no-op
 * everywhere else (plain `pnpm dev`, Vitest) — `globalThis.caches` simply doesn't exist there, so
 * every read is a miss and every write is skipped, which is the correct fallback (always compute
 * fresh) rather than a crash.
 */
function getEdgeCache(): Cache | undefined {
  // `caches.default` is a Cloudflare Workers runtime extension, not part of the standard DOM
  // `CacheStorage` type this project's lib target uses — hence the loose cast rather than `Cache`.
  const caches = (globalThis as { caches?: { default?: Cache } }).caches;
  return caches?.default;
}

export async function readEdgeCache(
  request: Request,
): Promise<Response | undefined> {
  const cache = getEdgeCache();
  return (await cache?.match(request)) ?? undefined;
}

/**
 * Stores a clone of `response` under `request`. The caller is responsible for the response's own
 * `Cache-Control` header (it doubles as the edge TTL this Cache API entry is stored with and as
 * what the requesting browser sees) — this just clones so storing it never consumes the body the
 * caller is about to send back to the client. Runs through Cloudflare's `waitUntil` when available
 * so the write never delays the response; a request whose body was already read (a 304, which has
 * none) is skipped since there is nothing meaningful to cache.
 */
/**
 * Deletes any cached edge responses for the given absolute URLs. Used only when a project's
 * delivery-relevant settings change (`publicDelivery` toggled, locales edited) — the brief calls
 * out disabling delivery specifically ("do not leave a long-lived public cache after disabling
 * delivery"), so that transition gets an immediate purge rather than resting solely on the
 * `s-maxage` bound the two `/i18n/*` routes otherwise rely on for write-freshness.
 */
export function purgeEdgeCache(event: H3Event, urls: string[]): void {
  const cache = getEdgeCache();

  if (!cache) {
    return;
  }

  const purge = Promise.all(urls.map((url) => cache.delete(url))).catch(() => {
    // Best-effort — a failed purge just means the existing TTL bound still applies.
  });

  const waitUntil = (
    event.context as { waitUntil?: (p: Promise<unknown>) => void }
  ).waitUntil;

  if (typeof waitUntil === 'function') {
    waitUntil(purge);
  } else {
    void purge;
  }
}

export function writeEdgeCache(
  event: H3Event,
  request: Request,
  response: Response,
): void {
  const cache = getEdgeCache();

  if (!cache || request.method !== 'GET' || !response.ok) {
    return;
  }

  const put = cache.put(request, response.clone()).catch(() => {
    // Best-effort — a failed cache write must never affect the response already sent.
  });

  const waitUntil = (
    event.context as { waitUntil?: (p: Promise<unknown>) => void }
  ).waitUntil;

  if (typeof waitUntil === 'function') {
    waitUntil(put);
  } else {
    void put;
  }
}
