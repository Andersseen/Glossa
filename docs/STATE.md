# Current State

Glossa is a single Analog.js application backed by ForgeCMS 0.4.x public npm packages.

## Implemented

- Project access tokens: `admin`-only create/list/revoke/delete
  (`/api/projects/:slug/tokens`), backed by Forge's `ApiKeyAuthAdapter` (prefix `glossa`,
  `glossa_<id>_<secret>`), bound to exactly one project via trusted `metadata.projectId`.
  Plaintext secret is returned once at creation and never persisted or shown again.
  `catalog:read`/`catalog:write` are the only whitelisted scopes; `catalog:write` always
  implies `catalog:read`. Deleting a project revokes every token bound to it.
- Machine catalog API under `/api/machine/v1/*` (`GET /project`, `GET /catalogs`,
  `GET /catalogs/:locale`, `PUT /catalogs/:locale`), Bearer-only, entirely separate from the
  human `/api/projects/*` surface. `GET /project` returns a manifest (slug, sourceLocale,
  locales, capabilities) so an agent needs only `GLOSSA_URL`/`GLOSSA_TOKEN` to discover a
  project — no hard-coded project id.
- Optimistic concurrency: every catalog write (human UI or machine API) regenerates a
  `revision`, surfaced as a standard `ETag`/`If-Match` pair on the machine API. A blind
  machine write to an existing catalog is refused (`412 CATALOG_REVISION_CONFLICT`); a human
  edit in between correctly invalidates a machine's now-stale revision.
- Project isolation is structural, not just checked: the machine API namespace carries no
  project selector at all — the token's own metadata is the only source of project identity
  for every machine route.
- Public runtime catalog delivery: an opt-in per-project `publicDelivery` flag (default
  `false`) gates unauthenticated `GET /i18n/:slug/manifest.json` and
  `GET /i18n/:slug/:locale.json`, returning raw catalog JSON (no envelope),
  `Access-Control-Allow-Origin: *`, `ETag`/conditional-GET, and a Cloudflare `caches.default`
  edge cache bounded to 30 seconds — explicitly purged on a `publicDelivery`/`locales`
  change so a disabled project stops being served immediately rather than waiting out the
  TTL. Disabled, unknown, and not-yet-created all return an identical `404`. See
  `docs/PUBLIC_DELIVERY.md`.
- Remote MCP server at `POST/GET/DELETE /mcp` (`@modelcontextprotocol/server` v2, Streamable
  HTTP, stateless — a fresh `McpServer` per request), authenticated with the same project
  access token as the machine API (`requireProjectMachineContext`, reused as-is — no
  MCP-specific auth path). Six tools: `get_project`, `list_catalogs`, `get_catalog`,
  `get_translation`, `set_translation`, `get_delivery_urls`, scoped by the same
  `catalog:read`/`catalog:write`. `set_translation` reuses the Machine API's
  `saveCatalogWithPrecondition` (`expectedRevision` → `If-Match`), so a stale agent write is
  rejected exactly like a stale machine `PUT`. See `docs/MCP.md`.

- Project CRUD with required name, unique slug, source locale, and locale list validation.
- JSON catalog list/get/save/delete for the default internal namespace.
- Existing catalog import: `POST /api/projects/:slug/catalogs/import/preview` (read-only) and
  `POST /api/projects/:slug/catalogs/import` (commit) let a project onboard the JSON locale
  files it already has, from the Catalogs tab's "Import catalogs" panel — multi-file
  drag-and-drop or file picker, filename-based locale inference (`en.json` → `en`) matched
  against the project's configured locales, with manual per-file correction and no silent
  creation of an unconfigured locale. The whole batch is preflighted (locale configured,
  locale not duplicated within the batch, catalog shape valid via the same
  `validateCatalogContent` the editor and machine API use) before anything is written; an
  existing catalog is never replaced without explicit per-file confirmation, enforced with
  the same revision/`If-Match` precondition `saveCatalogWithPrecondition` already provides —
  no second concurrency model. Every imported catalog is written through `CatalogService`,
  so it is indistinguishable from an editor or machine write: it appears in the Catalogs UI,
  the machine API, MCP, and (if `publicDelivery` is on) public delivery immediately, with no
  publish/sync step. See the "Migrating an existing project" section in `README.md`.
- ForgeCMS collections: `users`, `projects`, `catalogs`, `external_identities`, `sso_sessions`.
- Primary interactive auth: DevAuth OAuth 2.1/OIDC SSO (Authorization Code + PKCE S256,
  server-side code exchange, identity from `userinfo`).
- Application authorization: Glossa's own `users` collection, `admin`/`editor`/`viewer`
  roles — DevAuth never assigns a Glossa role.
- User provisioning: a DevAuth identity Glossa has not seen is provisioned automatically
  (first ever becomes `admin`, later ones `viewer`), or adopts an existing user with the
  same email. Who may hold an identity is DevAuth's decision via its signup allowlist;
  Glossa does not run a second gate on it. No bootstrap step is required for SSO.
- Application session: Glossa-owned opaque, D1-backed session (`sso_sessions`, SHA-256
  token hash only, 24h TTL) for DevAuth sign-ins, delivered through the same HttpOnly
  `forge_session` cookie via `CompositeAuthAdapter`.
- Fallback: Forge local email/password auth remains available as a break-glass path.
- DevAuth provider tokens (access/refresh/ID) are never persisted as a Glossa session.
- First-admin bootstrap through a one-time, server-side route protected by `BOOTSTRAP_ADMIN_KEY`.
- Phase-1 roles: `admin` and `editor` can write; `viewer` can read only.
- Cloudflare Pages target with D1 binding `DB`.

## Persistence

Translation JSON is stored in D1 through ForgeCMS. Glossa does not use R2/S3/object storage in this phase.

Project slugs are protected by a database unique constraint. Catalog identity is protected by a compound unique index on `project`, `locale`, and `namespace`. Catalogs carry a `revision` and `updatedAt`, regenerated on every write.

Project deletion is restricted while catalogs exist. Removing a project locale is rejected when that locale already has catalog content. Project deletion also revokes every access token bound to that project.

Project access tokens persist in Forge's own internal `_forge_api_keys` collection (never exposed as a Glossa/Forge CRUD collection); Glossa reaches it only through `ApiKeyAuthAdapter`'s own create/list/get/revoke/delete methods.

## Deferred

Catalog export, completeness and diff analysis, AI translation, translation memory, GitHub integration, teams, billing, OAuth, comments, review workflow, namespaces UI, and a CLI/repository-sync layer are intentionally deferred.

## Testing

Every Vitest spec — including catalog import and its public-delivery/MCP/machine-API
integration coverage — runs against Forge's `InMemoryDatabaseAdapter`, and Playwright's
`webServer` is plain `pnpm dev` (also in-memory); there is no `wrangler`-D1-backed or
`vitest-pool-workers` test runtime in this repository. Public delivery and MCP were
previously verified manually against a real local D1 database (`wrangler pages dev`),
including the full agent journey. Catalog import was **not** re-verified against a real D1
database in this milestone: `wrangler.jsonc` binds the one real D1 database this repository
has (`glossa`, a production id, not a disposable/local-only one), and `wrangler pages dev`
against it would write test projects/catalogs into shared production data; `.dev.vars` also
has no `BOOTSTRAP_ADMIN_KEY`/`AUTH_SECRET`, and the only interactive sign-in path
(`DEV_AUTH_ISSUER=https://auth-devflare.andersseen.dev`) is a real external identity
provider a human would need to complete. If real-D1 verification of import is wanted, run
`pnpm exec wrangler pages dev dist/analog/public` against a disposable D1 database (or the
production one, deliberately, with a throwaway test project) and repeat the same manual
journey as the prior public-delivery/MCP milestone: sign in, create a project, import a
small catalog from the UI, then confirm it through `/i18n/:slug/:locale.json`, the machine
API, and MCP. Building a real-D1 Vitest harness remains future infrastructure work.

## Next Milestone

Volt UI: first real consumer / dogfood. With existing-catalog import now in place, an
existing project's `en.json`/`es.json`/`uk.json` no longer need a script to reach Glossa —
Volt UI itself should only need an Etyma upgrade, `defineRemoteI18n`/`createHttpMessageLoader`,
and a Glossa base URL/token, not a migration step of its own. Point its runtime i18n loader
at a public Glossa delivery URL and its AI agents at the Glossa MCP endpoint, and see whether
that integration genuinely stays as small as this milestone was designed to make it.

Later: catalog export. Later still: completeness / diff / missing keys, CLI / repository
pull-push synchronization.
