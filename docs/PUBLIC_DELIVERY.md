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
Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=30
```

`Access-Control-Allow-Origin: *` is unconditional — this is a public, credential-free,
cross-origin-by-design surface, so it never mixes with the human UI's own cookie-based CORS
semantics. A conditional request is honored:

```bash
curl -s -H 'If-None-Match: "<revision>"' "$GLOSSA_URL/i18n/volt-ui/en.json"
# -> 304 Not Modified, no body
```

## Freshness

There is no separate publish step — a save through the human UI, the Machine API, or MCP's
`set_translation` is immediately the value `/i18n/*` will next compute. The only staleness
window is the edge cache in front of it:

- Cloudflare's `caches.default` (Cache API) fronts both routes with `s-maxage=30` — a
  freshly-computed response is reused for at most **30 seconds** before the next request
  recomputes it.
- Toggling `publicDelivery` (on **or** off) or editing a project's `locales` purges that
  project's cached manifest/catalog entries immediately — disabling delivery does not wait
  out the 30-second window; it stops serving the moment the setting is saved.
- A translation content edit (human, Machine API, or MCP) is not explicitly purged — it
  becomes visible within that same bounded 30 seconds.

## Read-only

`/i18n/*` only ever handles `GET` (and the conditional-GET machinery around it). Catalog
mutation stays on the human UI, the Machine API, and MCP — this surface never accepts
`POST`/`PUT`/`PATCH`/`DELETE`.
