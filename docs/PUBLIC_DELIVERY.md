# Public Delivery

Glossa can serve a project's translation catalogs as public, cacheable JSON, directly to a
running application — no authentication, no Glossa SDK, just `fetch()`. It is a deliberately
separate, small surface from the human UI and the Machine API: `CatalogService`/
`ProjectService` do the actual lookup in every case, so the three surfaces (UI, Machine API,
public delivery) can never disagree about what a catalog contains.

## Enabling it

Public delivery is **opt-in per project**, off by default. Toggle it from the project's
**Delivery** tab (`/projects/:slug`, Delivery tab), or via the human API:

```bash
curl -s -X PATCH \
  -H "Cookie: $SESSION_COOKIE" \
  -H 'Content-Type: application/json' \
  -d '{"publicDelivery":true}' \
  "$GLOSSA_URL/api/projects/volt-ui"
```

While disabled, every `/i18n/:project/*` request for that project returns a plain `404` —
the same 404 an unknown project or an unknown locale returns. Project existence is never
distinguishable from the outside.

## URL contract

```text
GET /i18n/:projectSlug/manifest.json
GET /i18n/:projectSlug/:locale.json
```

Production example:

```text
https://glossa.andersseen.dev/i18n/volt-ui/manifest.json
https://glossa.andersseen.dev/i18n/volt-ui/en.json
https://glossa.andersseen.dev/i18n/volt-ui/es.json
https://glossa.andersseen.dev/i18n/volt-ui/uk.json
```

Only the current default catalog namespace is exposed. No Forge record ids, namespace
details, or other internal identifiers appear in these URLs.

### Manifest

```json
{
  "project": {
    "slug": "volt-ui",
    "name": "Volt UI",
    "sourceLocale": "en",
    "locales": ["en", "es", "uk"]
  },
  "catalogs": {
    "en": {
      "url": "https://glossa.andersseen.dev/i18n/volt-ui/en.json",
      "revision": "..."
    }
  }
}
```

Only locales with a catalog that has actually been saved at least once appear under
`catalogs` — a configured-but-empty locale is simply absent, not listed with `null` content.

### Catalog

```text
GET /i18n/volt-ui/en.json
```

returns the raw translation object exactly as stored — no `{ "data": ... }` envelope, no
Glossa-specific parsing required:

```json
{ "nav": { "home": "Home", "docs": "Docs" } }
```

```ts
const translations = await fetch(
  'https://glossa.andersseen.dev/i18n/volt-ui/es.json',
).then((response) => response.json());
```

A locale outside the project's configured `locales`, or a configured locale with no catalog
saved yet, both return `404` — identical to an unknown project or a disabled one.

## Headers, CORS, and conditional requests

Every catalog response carries:

```http
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
ETag: "<catalog revision>"
Cache-Control: no-store
```

`Access-Control-Allow-Origin: *` is unconditional — this is a public, credential-free,
cross-origin-by-design surface, so it never mixes with the human UI's own cookie-based CORS
semantics. `Cache-Control: no-store` is also set on `304` and `404` responses. A conditional
request is honored, but only after the project's current state has been checked:

```bash
curl -s -H 'If-None-Match: "<revision>"' "$GLOSSA_URL/i18n/volt-ui/en.json"
# -> 304 Not Modified, no body
```

## Freshness and revocation

There is no separate publish step — a save through the human UI, the Machine API, or MCP's
`set_translation` is the value the very next `/i18n/*` request computes.

**Nothing on the server side caches these routes.** Every request loads the project and
catalog, so:

- Disabling `publicDelivery` makes the next request for the manifest and every locale URL
  return `404`.
- Deleting a project does the same (the project no longer resolves).
- A conditional request with a previously valid `If-None-Match` also gets `404` once delivery
  is disabled or the project is gone: `304` is only produced for a project that passed the
  availability checks and whose revision still matches. A catalog edit changes the revision, so
  the old `ETag` stops matching and the full body is returned.
- Unknown project, disabled project, unconfigured locale and missing catalog stay
  indistinguishable plain `404`s.

### Why there is no edge cache

An earlier version put Cloudflare's Cache API (`caches.default`) in front of both routes with
`s-maxage=30` and tried to `caches.default.delete()` entries on settings changes. The Cache API
is local to the data center that runs the Worker, so a purge in one location does not
invalidate copies in others, and a cached hit was returned before the project's state was
checked. A disabled or deleted project could therefore keep serving catalogs elsewhere.
`s-maxage` and `stale-while-revalidate` likewise let any shared cache keep serving a revoked
catalog. Both were removed rather than papered over with a global purge.

### Guarantee and limits

- Once the deployed Worker serves a request after the settings change is committed, it returns
  `404`. Requests already in flight when the change is saved can still complete with the
  previous content, and the new behavior applies only once the deployment containing it is live
  everywhere.
- Glossa cannot recall copies already downloaded: browsers, third-party CDNs, build outputs
  (e.g. a static site generated from a catalog), and other applications keep whatever they
  fetched. `no-store` tells compliant caches not to keep copies, but it is a request, not a
  guarantee, and nothing HTTP offers can revoke content a client already has.
- Tradeoff: every request now reads the project and catalog from D1 instead of being absorbed
  by the 30-second edge cache. Consumers that want to cache should do so on their side (or at
  build time) and accept that their copy is not revocable by Glossa.

## Read-only

`/i18n/*` only ever handles `GET` (and the conditional-GET machinery around it). Catalog
mutation stays on the human UI, the Machine API, and MCP — this surface never accepts
`POST`/`PUT`/`PATCH`/`DELETE`.
