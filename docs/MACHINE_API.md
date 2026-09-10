# Machine API

Glossa's machine API lets an AI coding agent, CI process, or developer tool discover a
project, read its translation catalogs, and update them — without a human browser session.
It is a deliberately separate, small surface from the human UI's own `/api/projects/*`
routes: Glossa owns this contract, backed by its own services, not generic ForgeCMS CRUD.

## Authentication

A project access token is created by an `admin` from the project's **Access tokens**
panel (`/projects/:slug`, Access tokens tab). The plaintext token is shown exactly once at
creation — copy it immediately, it cannot be viewed again.

```bash
export GLOSSA_URL="https://glossa.example"
export GLOSSA_TOKEN="glossa_..."
```

Every machine request authenticates with a bearer token:

```http
Authorization: Bearer <GLOSSA_TOKEN>
```

There is no query-string token, cookie, or custom header — Bearer only. A browser session
cookie never authorizes these routes, and a project access token never authorizes the human
`/api/projects/*` routes: the two credential types are intentionally separate.

## Scopes

A token carries one or both of:

- `catalog:read` — discover the project, list catalogs, read catalog content.
- `catalog:write` — everything `catalog:read` grants, plus creating/updating catalog
  content. A token created with write access is always issued both scopes.

Scopes are enforced on every request; a token without `catalog:write` gets `403
INVALID_SCOPE` on a write, regardless of what the UI happened to show when it was created.

## Discovery flow

```text
1. GET /api/machine/v1/project
2. inspect sourceLocale / locales / capabilities
3. GET /api/machine/v1/catalogs
4. GET /api/machine/v1/catalogs/:locale
5. edit the content locally
6. PUT /api/machine/v1/catalogs/:locale with If-Match: "<revision from step 4>"
7. on 412, GET the catalog again and retry deliberately — never overwrite blindly
```

A token identifies exactly one project — there is no `?project=` parameter and no
`/projects/:id` segment in this namespace. The project comes from the token itself, so an
agent never has to hard-code a project id.

### 1. Project manifest

```bash
curl -s \
  -H "Authorization: Bearer $GLOSSA_TOKEN" \
  "$GLOSSA_URL/api/machine/v1/project"
```

```json
{
  "data": {
    "project": {
      "id": "...",
      "slug": "volt-ui",
      "name": "Volt UI",
      "sourceLocale": "en",
      "locales": ["en", "es", "uk"]
    },
    "capabilities": {
      "catalogRead": true,
      "catalogWrite": true
    }
  }
}
```

### 2. List catalogs

```bash
curl -s \
  -H "Authorization: Bearer $GLOSSA_TOKEN" \
  "$GLOSSA_URL/api/machine/v1/catalogs"
```

```json
{
  "data": [
    { "locale": "en", "namespace": "", "revision": "...", "updatedAt": "..." }
  ]
}
```

A locale never appears here until it has been saved at least once.

### 3. Read a catalog

```bash
curl -si \
  -H "Authorization: Bearer $GLOSSA_TOKEN" \
  "$GLOSSA_URL/api/machine/v1/catalogs/en"
```

The revision is returned two ways — as the standard `ETag` response header, and as
`data.revision` in the body, so an agent never has to parse headers if it would rather not:

```http
ETag: "IvE1_MBLBcEvFXhOeO53zQ"
```

```json
{
  "data": {
    "locale": "en",
    "namespace": "",
    "content": { "button": { "save": "Save" } },
    "revision": "IvE1_MBLBcEvFXhOeO53zQ",
    "updatedAt": "2026-09-10T12:08:21.657Z"
  }
}
```

A locale that is not part of the project's configured `locales` returns
`404 LOCALE_NOT_CONFIGURED` — a machine token cannot invent a new locale.

### 4. Write a catalog

Optimistic concurrency uses standard HTTP preconditions — `If-Match/If-None-Match` — not a
body field, because both a human and an agent can be editing the same catalog:

```bash
curl -si \
  -X PUT \
  -H "Authorization: Bearer $GLOSSA_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "IvE1_MBLBcEvFXhOeO53zQ"' \
  -d '{"content":{"button":{"save":"Save","cancel":"Cancel"}}}' \
  "$GLOSSA_URL/api/machine/v1/catalogs/en"
```

Rules, deliberately simple:

- **Existing catalog, no `If-Match` or a stale one** → `412 CATALOG_REVISION_CONFLICT`. A
  blind write to an existing catalog is always refused — this is what makes it safe for a
  human and an agent to edit the same project.
- **Existing catalog, correct `If-Match`** → applied; the response carries the new revision
  and `ETag`.
- **Missing locale, no precondition header (or `If-None-Match: *`)** → created.
- **Missing locale, an `If-Match` header** → `412`, nothing to match yet.

On `412`, re-read the catalog, look at the current content and `revision`, and decide how to
reconcile before retrying — Glossa does not attempt to merge for you.

The body only ever carries `content`. `project`, `namespace`, and `locale` come from the
token and the URL, never from JSON — a token cannot smuggle a write into a different
project by way of the request body.

Every machine write runs through the same `CatalogService` a human save does: the same JSON
structure validation, the same configured-locale check, the same project/locale/namespace
identity rules. There is no separate, looser write path for machines.

## Error shape

Every response is one consistent envelope:

```json
{ "data": {} }
```

or

```json
{
  "error": {
    "code": "CATALOG_REVISION_CONFLICT",
    "message": "Catalog changed since it was read."
  }
}
```

Stable codes an agent can branch on: `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_SCOPE`,
`PROJECT_NOT_FOUND`, `LOCALE_NOT_CONFIGURED`, `CATALOG_NOT_FOUND`,
`CATALOG_REVISION_CONFLICT`, `INVALID_CATALOG`. Nothing here leaks a database or Forge
internal error — an unexpected server failure is a `500` with no further detail.

## `glossa.json` (optional, documented groundwork only)

A repository may optionally declare which Glossa project it belongs to, for future
tooling (CLI, MCP) to read:

```json
{
  "$schema": "https://glossa.example/schema.json",
  "project": "volt-ui",
  "api": "https://glossa.example"
}
```

The token is **never** part of this file — it always comes from the `GLOSSA_TOKEN`
environment/secret, not a committed file. This file is not required by the machine API
itself (which only needs `GLOSSA_URL` + `GLOSSA_TOKEN`), and this milestone does not ship a
parser or CLI for it — see Non-goals below.

## Non-goals (this milestone)

The machine API and project access tokens are the primitive; the following are intentionally
not built yet:

- An MCP server or any Claude/Codex/Agentyx-specific integration.
- A `glossa` CLI (`pull`/`push`/`login`).
- Filesystem synchronization or a GitHub App/automatic commits.
- Completeness, missing-key, or diff analysis.
- Three-way merge or any automatic conflict resolution — `412` plus a deliberate re-read
  and retry is the whole contract.
