# Current State

Glossa is a single Analog.js application backed by ForgeCMS 0.4.x public npm packages.

## Implemented

- **Translation Workspace V1** — the human editing surface, and the normal way translations are
  edited. The project's `Translations` tab is key-centric and cross-locale: the source-locale
  catalog defines the canonical key list, and each key is shown once with its value in every
  configured locale, instead of a person opening `en.json`/`es.json`/`uk.json` and searching
  each one. Includes client-side search (key and source value), All/Missing/Complete filters,
  a compact total/complete/missing summary, first-segment grouping, a multi-locale key editor
  with the source locale first, and **Add translation** for creating a key (source value
  required, target values optional). Raw JSON catalog editing is kept, relabelled as the
  advanced escape hatch. Create, edit, rename, and delete are all supported — see
  **Translation Key Lifecycle V1** below for rename/delete.
  - **No new storage.** Nested JSON catalogs remain the only source of truth; no translation
    row/key table, no new Forge collection, no schema change. The workspace is a view and a
    key-scoped editing API over the existing catalogs.
  - **One shared domain layer.** `src/server/domain/translation-tree.ts` flattens a catalog into
    dot-path leaves and builds the cross-locale entries; it reads the same disallowed-segment
    rule as the MCP-facing `parseTranslationKeyPath` (`isAddressableTranslationSegment`) rather
    than introducing a second key parser. A stored key that cannot round-trip through that
    parser (an unsafe segment, or a segment containing a literal `.`) is skipped by the
    workspace rather than listed as a row that could never be saved — it stays stored and
    remains editable in the raw JSON editor.
  - **Presence, not truthiness.** A locale "has" a key when the key exists as a string leaf in
    that catalog. An empty string is a stored value, so clearing a translation does not make the
    key report as missing again.
  - **Human API**: `GET/PATCH/POST /api/projects/:slug/translations`, behind the same
    `requireUser`/`requireWriteUser` boundary as every other human route (a machine token is
    rejected here exactly as on other `/api/projects/*` routes). `GET` returns the whole
    workspace in a single request — ~1,000–2,000 keys is the expected size, search and filtering
    are client-side, and there is deliberately no per-key read endpoint to call in a loop.
    `PATCH` submits one key and only the locales that changed; `POST` creates a key.
  - **Concurrency**: every changed locale carries the revision the workspace was loaded with and
    is written through `saveCatalogWithPrecondition` — the same optimistic-concurrency model the
    machine API, MCP, and catalog import already use. A stale save is rejected (`409`, per-locale
    `CATALOG_REVISION_CONFLICT`) and the newer content survives. A multi-locale save is
    preflighted first, so a conflict on one locale writes none of them; there is no transaction
    across catalog rows and none is claimed — the response reports per locale what was saved and
    what was not, and the UI never says "Saved" for a locale that failed. A failed save
    deliberately does not adopt the server's newer revisions client-side; the human reloads.
  - **No sync step**: writes go through `CatalogService`, so a human edit is immediately visible
    to the raw JSON editor, machine API, MCP `get_translation`, and public delivery.
  - Roles: `admin`/`editor` edit; `viewer` can search, filter, select and read, with read-only
    fields, no Save, and no Add translation (enforced server-side, not just in the UI).
- **Translation Key Lifecycle V1** — safe project-wide rename and delete of a canonical source
  key, from the Translation Workspace or MCP, with no Raw JSON required.
  - **Domain**: `renameTranslationValue`/`deleteTranslationValue`/`pathExists` in
    `src/server/domain/translation-path.ts`, next to `getTranslationValue`/`setTranslationValue`
    since they operate the same way (one `CatalogContent`, one or two paths). Rename combines
    `deleteTranslationValue` and `setTranslationValue` rather than a third traversal; both prune
    every now-empty ancestor left behind, never an unrelated branch, and preserve MessageFormat
    values byte-for-byte since neither parses the string. A path with nothing to rename/delete
    is a same-reference no-op. A rename onto a path that already holds anything (value or group)
    is refused with `TranslationKeyCollisionError`, same-old-and-new-key with
    `InvalidTranslationKeyError`.
  - **Service**: `renameProjectTranslationKey`/`deleteProjectTranslationKey` in
    `src/server/services/translation-lifecycle.service.ts` orchestrate the rename/delete across
    every configured locale, reusing `loadCatalogs`/`readExpectedRevisions`/`requireKey`
    (exported from `translation-workspace.service.ts`, not duplicated) and
    `saveCatalogWithPrecondition`. **Preflighted before any write**: every _existing_ project
    catalog's revision must match `expectedRevisions` (not just the locales the operation
    touches) or the whole thing is refused with `TranslationLifecycleConflictError`
    (`409 CATALOG_REVISION_CONFLICT`, per-locale `conflicts`); the key must exist in the source
    locale (`TranslationNotFoundError`, `404`); a rename's `newKey` must not already exist in
    _any_ configured locale, including a target-only orphan the source locale never defined
    (`TranslationKeyCollisionError`, `409 TRANSLATION_KEY_COLLISION`). A locale with no catalog,
    or that never had the key, is silently skipped — never created, never an error. No real
    cross-catalog transaction exists in the current Forge/D1 abstraction, and none is invented:
    after a clean preflight, each locale is still written independently through
    `saveCatalogWithPrecondition`, and the response's per-locale `results` report exactly what
    was saved if a genuine race still occurs in that narrow window — no claimed rollback.
  - **Human API**: `POST /api/projects/:slug/translations/rename` and `.../delete`, dedicated
    routes rather than a flag on the value-edit `PATCH` (the request/response shape is a
    different, all-or-nothing operation). Same `requireWriteUser` boundary as every other
    `/api/projects/*` route — `admin`/`editor` write, `viewer` and machine tokens rejected.
  - **MCP parity**: `rename_translation`/`delete_translation` tools, requiring
    `catalog:write`, calling the exact same lifecycle service as the human routes — no
    duplicated rename/delete/collision/preflight logic between them. See `docs/MCP.md`.
  - **UI**: `Rename key` and `Delete key` on the selected key in the Translation Workspace
    (`rename-key-panel.ts`/`delete-key-panel.ts`, self-contained like `AddTranslationPanel` —
    own drawer, request, and error state). Rename warns that application code using the old key
    may need updating; delete is a destructive confirmation showing the key and its stored
    values. Both are disabled while the selected key has unsaved edits
    (`TranslationKeyEditor` emits `dirtyChange`) rather than silently discarding them. A stale-
    revision conflict shows the same "reload before continuing" message the value-edit path
    uses, with no silent retry. On success the workspace reloads and reselects the renamed key,
    or falls back to the next remaining key (or empty) after a delete.
  - **Machine API is unchanged** — no new REST endpoints; key-lifecycle primitives are
    human-workspace/MCP-only in this milestone.
  - Deliberately deferred: target-only orphan-key cleanup, bulk rename/delete, undo/history,
    audit log, and a "move key" UI distinct from rename.
- **Completeness / Diff / Missing Keys V2 — DONE.** Project-wide translation-completeness and
  structural key-set diff, for humans (Analysis mode in the Translations tab) and AI agents
  (`analyze_translations` over MCP), both reading the exact same domain/service layer as each
  other and as the Translation Workspace.
  - **Domain**: `analyzeTranslations` in `src/server/domain/translation-tree.ts`, built on the
    existing `flattenCatalogLeaves`/`toTranslationMap`/`buildTranslationEntries`/
    `summarizeTranslationEntries` rather than a second recursive catalog walker — the Workspace
    and Analysis therefore agree on exactly the same addressable-key semantics (an unsafe or
    dot-containing stored segment is skipped identically on both surfaces). Per configured
    locale: `catalogExists`, `totalSourceKeys`, `translatedKeys`, `missingKeys` (exact source
    keys absent, in source-catalog order), `extraKeys` (exact target-only keys, in that
    locale's own catalog order — never deleted, never counted toward `totalSourceKeys`), and
    `coverage` (`translatedKeys / totalSourceKeys`, or `null` — never an invented percentage —
    only when there are zero source keys). The source locale always reports `missingKeys: []`
    and `extraKeys: []` relative to itself. Project-wide `completeKeys`/`incompleteKeys` reuse
    `buildTranslationEntries`/`summarizeTranslationEntries` directly rather than a second
    "complete" definition. Diff is **structural** (key presence), never a comparison of
    translated values.
  - **Service**: `getTranslationAnalysis` in
    `src/server/services/translation-analysis.service.ts` — one `getProjectBySlug` +
    `loadCatalogs` (the same load the Workspace uses), then an in-memory comparison; no
    per-key or per-locale request, no new storage, no persisted/cached analysis.
  - **Human API**: `GET /api/projects/:slug/translations/analysis`, same `requireUser`
    boundary as the Workspace GET — `admin`/`editor`/`viewer` read, unauthenticated and machine
    project tokens rejected, read-only (no mutation, no query parameters).
  - **MCP**: `analyze_translations`, no arguments (project identity comes from the token, like
    every other tool), requires `catalog:read`, calls the exact same service as the human API.
    Returns keys and counts, never full catalog values — far cheaper than `get_catalog` once
    per locale for the same question.
  - **UI**: a lightweight Workspace/Analysis switch inside the existing Translations tab (a
    plain segmented button group, not a nested tabset, and not a second top-level project
    tab) — Workspace remains the default. Analysis shows a compact project summary, a
    per-locale coverage list (a simple CSS progress bar plus explicit fraction/count text, no
    chart library, no color-only signal), and, per selected locale, its exact missing and
    extra keys. Clicking a missing key switches back to the one Workspace editor with that key
    already selected — no second translation editor exists. Extra keys are listed with an
    explanation and a link to the raw JSON catalog; no delete action exists for them yet.
  - Deliberately deferred: target-only orphan-key cleanup/deletion, a translation-quality or
    confidence score of any kind, and a Machine API analysis endpoint (MCP is the agent-facing
    surface for this).
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
  MCP-specific auth path). The server exposes project-scoped translation tools including
  `get_project`, `list_catalogs`, `get_catalog`, `get_translation`, `set_translation`,
  `rename_translation`, `delete_translation`, `analyze_translations`, and
  `get_delivery_urls`, scoped by the same `catalog:read`/`catalog:write`. `set_translation`
  reuses the Machine API's `saveCatalogWithPrecondition` (`expectedRevision` → `If-Match`), so a
  stale agent write is rejected exactly like a stale machine `PUT`. See `docs/MCP.md`.

- Project CRUD with required name, unique slug, source locale, and locale list validation.
- JSON catalog list/get/save/delete for the default internal namespace.
- Existing catalog import: `POST /api/projects/:slug/catalogs/import/preview` (read-only) and
  `POST /api/projects/:slug/catalogs/import` (commit) let a project onboard the JSON locale
  files it already has, from the Overview tab's "Import catalogs" panel — multi-file
  drag-and-drop or file picker, filename-based locale inference (`en.json` → `en`) matched
  against the project's configured locales, with manual per-file correction and no silent
  creation of an unconfigured locale. The whole batch is preflighted (locale configured,
  locale not duplicated within the batch, catalog shape valid via the same
  `validateCatalogContent` the editor and machine API use) before anything is written; an
  existing catalog is never replaced without explicit per-file confirmation, enforced with
  the same revision/`If-Match` precondition `saveCatalogWithPrecondition` already provides —
  no second concurrency model. Every imported catalog is written through `CatalogService`,
  so it is indistinguishable from an editor or machine write: it appears in the Translations
  workspace, the raw catalogs UI, the machine API, MCP, and (if `publicDelivery` is on) public
  delivery immediately, with no publish/sync step. See the "Migrating an existing project" section in `README.md`.
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

Catalog export, AI translation, translation memory, GitHub integration, teams, billing, OAuth,
comments, review workflow, namespaces UI, and a CLI/repository-sync layer are intentionally
deferred. Target-locale keys the source locale does not define are left stored and untouched;
Analysis reports them exactly (which keys, in which locale) and the Workspace still only
counts them as a diagnostic, but cleaning them up (target-only orphan cleanup) remains a
raw-JSON task — neither Translation Key Lifecycle V1 nor Completeness/Diff V2 solves this, only
surfaces it. Also still deferred: bulk rename/delete, undo/history, an audit log, a "move key"
UI distinct from rename, and any translation-quality/confidence score (Analysis reports factual
coverage only).

## Testing

Every Vitest spec — including the translation workspace, the translation key lifecycle
(rename/delete), catalog import, and their public-delivery/MCP/machine-API integration coverage
— runs against Forge's `InMemoryDatabaseAdapter`, and Playwright's
`webServer` is plain `pnpm dev` (also in-memory); there is no `wrangler`-D1-backed or
`vitest-pool-workers` test runtime in this repository. Public delivery and MCP were
previously verified manually against a real local D1 database (`wrangler pages dev`),
including the full agent journey. Catalog import was **not** re-verified against a real D1
database, and neither was the Translation Workspace: `wrangler.jsonc` binds the one real D1 database this repository
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

## Next Milestone Candidates

**Volt UI: first real consumer / dogfood** — recommended next, ahead of AI translation or any
other major Glossa feature. See "Still Open" below.

## Still Open

Volt UI: first real consumer / dogfood — planned after catalog import and not yet done. With
existing-catalog import, key lifecycle, and completeness/diff analysis all in place, an
existing project's `en.json`/`es.json`/`uk.json` no longer need a script to reach Glossa —
Volt UI itself should only need an Etyma upgrade, `defineRemoteI18n`/`createHttpMessageLoader`,
and a Glossa base URL/token, not a migration step of its own. Point its runtime i18n loader
at a public Glossa delivery URL and its AI agents at the Glossa MCP endpoint, and see whether
that integration genuinely stays as small as the import milestone was designed to make it. This
is the recommended next milestone, before AI translation, quality scoring, translation memory,
review workflows, or orphan-key cleanup — validating Glossa's UI, Public Delivery, Etyma remote
catalogs, MCP, and Analysis against a real external project first.

Later: catalog export. Later still: CLI / repository pull-push synchronization.
