# MCP

Glossa runs a remote, project-scoped [MCP](https://modelcontextprotocol.io) server so an AI
coding agent can read and update translation catalogs directly — without a consumer
repository implementing any REST glue of its own. It shares the exact same `CatalogService`/
`ProjectService` and project-access-token machine auth the Machine API already uses; MCP is
another way in, not a second implementation.

## Endpoint

```text
POST https://glossa.andersseen.dev/mcp
```

Streamable HTTP (the current MCP transport), stateless — every request is authenticated and
handled independently, with no server-side session to keep alive between calls.

## Authentication

The **same project access token** used for the Machine API — create one from the project's
**Access tokens** panel (`/projects/:slug`, Access tokens tab), then:

```http
Authorization: Bearer glossa_...
```

- A missing, malformed, revoked, or expired token is rejected the same way the Machine API
  already rejects it.
- A human DevAuth/password session cookie **never** authenticates MCP — only a project
  access token does. The two credential types stay as separate here as they already are for
  `/api/machine/v1/*`.
- There is no separate MCP-specific token type, personal access token, or OAuth flow to set
  up — one project token works for the Machine API and MCP, according to its scopes.

## Project scope

The token's `metadata.projectId` is the only source of project identity. No tool below
accepts a `project`/`projectId`/`slug` argument — an agent connects with a token and Glossa
already knows which project it is; there is no way to point one connection at a different
project.

## Scopes

Reuses the Machine API's two scopes — no new ones for MCP:

| Tool                 | Requires        |
| -------------------- | --------------- |
| `get_project`        | `catalog:read`  |
| `list_catalogs`      | `catalog:read`  |
| `get_catalog`        | `catalog:read`  |
| `get_translation`    | `catalog:read`  |
| `get_delivery_urls`  | `catalog:read`  |
| `set_translation`    | `catalog:write` |
| `rename_translation` | `catalog:write` |
| `delete_translation` | `catalog:write` |

A token created with write access is always issued both scopes, matching the Machine API.
Calling a tool without the required scope does not close the connection — it returns a tool
error with `code: "INVALID_SCOPE"`.

## Tools

### `get_project`

No arguments. The project associated with the token, plus what the token itself may do:

```json
{
  "slug": "volt-ui",
  "name": "Volt UI",
  "sourceLocale": "en",
  "locales": ["en", "es", "uk"],
  "capabilities": { "catalogRead": true, "catalogWrite": true }
}
```

### `list_catalogs`

No arguments. Every configured locale, whether a catalog exists yet, and its revision —
never the catalog content itself.

### `get_catalog`

Input: `{ "locale": "en" }`. The **only** tool that returns full catalog content — prefer
`get_translation` to read a single key.

### `get_translation`

Input: `{ "locale": "en", "key": "nav.home" }` — `key` is a dot-path into the catalog's
nested JSON (`nav.home` → `content.nav.home`).

```json
{
  "locale": "en",
  "key": "nav.home",
  "exists": true,
  "value": "Home",
  "revision": "..."
}
```

Use the returned `revision` as `expectedRevision` on a following `set_translation`.

### `set_translation`

Input: `{ "locale": "en", "key": "nav.changelog", "value": "Changelog", "expectedRevision": "..." }`

Creates or replaces exactly that one value — written verbatim, never translated or
reformatted by Glossa. `expectedRevision` is the concurrency guard:

- Writing to an **existing** catalog requires the current revision (from a prior
  `get_translation`/`get_catalog`/`list_catalogs`); a stale or missing value is rejected with
  `CATALOG_REVISION_CONFLICT` rather than silently overwriting a human or another agent's
  edit.
- A configured locale with **no catalog yet** may be created by omitting
  `expectedRevision` — the same safe-create semantics the Machine API's `PUT` already has. A
  locale outside the project's configured `locales` is refused (`LOCALE_NOT_CONFIGURED`),
  never silently created.

A stale write leaves the newer content untouched — re-read and retry deliberately, the same
contract as the Machine API's `412`.

### `rename_translation`

Input:

```json
{
  "key": "nav.home",
  "newKey": "navigation.home",
  "expectedRevisions": { "en": "...", "es": "...", "uk": "..." }
}
```

Renames one logical key across **every existing catalog** in the project, not one locale at a
time: the value at `key` moves to `newKey` in every locale that has it, preserved exactly, and
a locale that never had the key stays without it. `expectedRevisions` must carry the current
revision of every configured locale that already has a catalog — a locale with no catalog yet
is simply omitted. List/read tools first, then pass those revisions here.

The whole rename is preflighted before any write:

- Any stale or missing revision for an existing catalog rejects the whole operation with
  `CATALOG_REVISION_CONFLICT` (including the per-locale `conflicts` it found) — no catalog is
  written.
- A `key` that does not exist in the source locale is rejected with `TRANSLATION_NOT_FOUND`.
- A `newKey` that already exists in **any** configured locale — even a target-only key the
  source locale does not define — is rejected with `TRANSLATION_KEY_COLLISION`, and nothing is
  written. Renaming never overwrites an existing value.
- `newKey` equal to `key` is rejected as an invalid, no-op rename.

Reuses the exact same service the human Translation Workspace's **Rename key** action calls —
there is one rename implementation, not one per surface.

### `delete_translation`

Input: `{ "key": "legacy.banner.title", "expectedRevisions": { "en": "..." } }`

Deletes one logical key from every existing catalog that has it, pruning any parent group left
empty; a locale that never had the key is left untouched, not treated as an error. Same
revision preflight as `rename_translation` (`CATALOG_REVISION_CONFLICT` on any stale/missing
entry), and `key` must exist in the source locale (`TRANSLATION_NOT_FOUND` otherwise). Reuses
the same service the Workspace's **Delete key** action calls.

### `get_delivery_urls`

No arguments. The public [delivery](./PUBLIC_DELIVERY.md) URLs for this project, and whether
delivery is currently enabled — useful for configuring a consuming application's i18n loader:

```json
{
  "enabled": true,
  "manifest": "https://glossa.andersseen.dev/i18n/volt-ui/manifest.json",
  "catalogs": {
    "en": "https://glossa.andersseen.dev/i18n/volt-ui/en.json",
    "es": "https://glossa.andersseen.dev/i18n/volt-ui/es.json",
    "uk": "https://glossa.andersseen.dev/i18n/volt-ui/uk.json"
  }
}
```

## Errors

Every failing tool call returns `isError: true` with a small, stable JSON code — never a raw
SQL/Forge error or a stack trace:

`UNAUTHORIZED`, `FORBIDDEN`, `INVALID_SCOPE`, `LOCALE_NOT_CONFIGURED`, `CATALOG_NOT_FOUND`,
`TRANSLATION_NOT_FOUND`, `TRANSLATION_KEY_COLLISION`, `CATALOG_REVISION_CONFLICT`,
`INVALID_TRANSLATION_KEY`, `INVALID_TRANSLATION_VALUE`, `DELIVERY_DISABLED`.

`CATALOG_REVISION_CONFLICT` carries `currentRevision` for `set_translation`'s single-locale
conflict, or `conflicts` (locale → current revision) for `rename_translation`/
`delete_translation`'s project-wide preflight — either way, enough to re-read and retry
without a second round trip.

## Client configuration

Generic reference config — verify the exact syntax for whichever MCP client you use:

```json
{
  "mcpServers": {
    "glossa": {
      "url": "https://glossa.andersseen.dev/mcp",
      "headers": {
        "Authorization": "Bearer ${GLOSSA_TOKEN}"
      }
    }
  }
}
```

`GLOSSA_TOKEN` is a project access token from the project's Access tokens panel, stored as a
secret in the agent's or CI's own secret storage — never committed, and never shown by Glossa
again after the token is first created.

## What MCP does not do (yet)

- No translation-memory or AI translation — `set_translation` writes exactly the value it is
  given.
- No `delete_catalog`/`delete_project` tool — those remain human/Machine-API-only operations;
  `rename_translation`/`delete_translation` operate on one key, never a whole catalog.
- No bulk rename/delete, and no cleanup tool for a target-only key the source locale never
  defined — both are deliberately deferred.
- No project/user/token-management tools — token lifecycle stays on the human UI and the
  Machine API.
- No completeness/missing-key/diff tools yet — those depend on a later Glossa milestone.
