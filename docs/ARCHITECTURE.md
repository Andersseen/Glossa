# Architecture

Glossa is currently a single Analog.js application. Analog provides the Angular UI, server rendering, and API route layer.

```text
Angular / Analog UI
  -> Glossa API
  -> Glossa services and domain
  -> ForgeCMS runtime
  -> Cloudflare D1
```

## Boundaries

The UI should call Glossa-owned API routes or application services. It should not access D1 or ForgeCMS adapters directly.

API route handlers should stay thin: parse the request, authenticate when authentication exists, call a service/domain operation, and serialize a response.

Business logic belongs in Glossa domain/services, not Angular components and not HTTP handlers.

## Authentication

DevAuth (an external, already-deployed OAuth 2.1/OIDC provider) is Glossa's primary
interactive login. DevAuth answers "who is this"; Glossa's own `users` collection
(`admin`/`editor`/`viewer`) answers "what may they do" and stays authoritative.

```text
Browser
  -> GET /api/auth/sso/login        (state, nonce, PKCE S256; short-lived HttpOnly
                                      glossa_oauth_tx cookie)
  -> DevAuth authorize endpoint      (existing DevAuth provider session -> no
                                      credential prompt)
  -> GET /api/auth/sso/callback      (server-side code exchange, DevAuth userinfo)
  -> identity resolved: issuer/provider + subject
       -> existing `external_identities` mapping, or
       -> first-time link to an existing Glossa user with the same email, or
       -> a new user provisioned from the identity (first ever -> admin,
          afterwards -> viewer)
  -> Glossa's own opaque session created (sso_sessions, SHA-256 token hash only)
  -> HttpOnly forge_session cookie
  -> /projects
```

DevAuth's access/refresh/ID tokens are discarded immediately after the `userinfo` call —
they are never persisted, never reach Angular, and never become Glossa's session.

The trust boundary is deliberate: DevAuth decides _who may hold an identity_ (it applies a
signup allowlist to every account-creation path and fails closed), so Glossa provisions a
user for any identity it vouches for rather than running a second gate on the same question.
Glossa decides _what that person may do_ — the role on their local user row, which DevAuth
can neither set nor influence. Note this means `email_verified` is not used as a gate: this
provider has no transactional email configured and runs with `requireEmailVerification:
false`, so legitimate accounts there carry `email_verified: false`.

`CompositeAuthAdapter([GlossaSsoAuthAdapter, UsersCollectionAuthAdapter, ApiKeyAuthAdapter])`
(`src/server/cms/runtime.ts`) is the single auth boundary every protected route already
calls through `requireAuth`/`requireWriteUser` — routes never branch on which strategy
authenticated the request. `GlossaSsoAuthAdapter.canHandleToken` recognizes the
`glossa_sso_...` prefix; a Forge password-signed token routes to
`UsersCollectionAuthAdapter`; a project access token (`glossa_<id>_<secret>`) routes to
`ApiKeyAuthAdapter`, each via a cheap synchronous format check so a token that isn't theirs
never costs a database round trip. Local email/password sign-in remains available as a
break-glass fallback if DevAuth is unavailable.

See `src/server/auth/` for the OIDC protocol boundary (discovery, PKCE, token exchange,
userinfo — no ID-token decoding; identity comes from an authenticated `userinfo` call
only) and `.env.example`/README.md for the required `DEV_AUTH_*` configuration.

ForgeCMS is infrastructure for Glossa. It provides generic CMS/data capabilities under the product, but its generic CRUD API is not Glossa's external API contract.

## Machine authentication and the machine API

A project such as Volt UI can hold a Glossa-issued **project access token** — a machine
credential, scoped to exactly one project, that lets an AI coding agent, CI process, or
developer tool discover the project and read/write its catalogs without a human browser
session. See `docs/MACHINE_API.md` for the full HTTP contract and agent-facing usage guide.

```text
HUMAN                                  MACHINE
  |                                       |
DevAuth SSO / password              GLOSSA_PROJECT_TOKEN
  |                                       |
Glossa UI                          Glossa Machine API  (/api/machine/v1/*)
  |                                       |
projects/catalogs  <---- CatalogService ----> scoped project (from token metadata)
```

**Tokens are Forge's own `ApiKeyAuthAdapter`** (`@forge-cms/auth`), instantiated with the
Glossa-specific prefix `glossa` (`PROJECT_TOKEN_PREFIX`, `src/server/cms/runtime.ts`) and
bound to the same D1/in-memory database as everything else via `apiKeyDatabase` in the
runtime env. Glossa does not implement its own token crypto, hashing, or storage — Forge
already generates the secret with Web Crypto, stores only a SHA-256 digest, and returns the
plaintext exactly once. `getProjectApiKeyAdapter(runtime)` (mirroring the existing
`getPasswordAuthAdapter`) is the one place Glossa reaches into that adapter directly, for the
create/list/get/revoke/delete operations `CompositeAuthAdapter` deliberately does not expose.

**Project binding is authorization-relevant metadata, not the plaintext token.** Every
created token carries `metadata: { projectId, projectSlug }`; only `projectId` (immutable)
is ever used to decide access — `projectSlug` is a display-only snapshot. `ApiKeyAuthAdapter`
is authored as a _generic_ Forge primitive with no notion of "project," so `_forge_api_keys`
is a single, app-wide collection: `src/server/services/project-token.service.ts` filters
every list by `metadata.projectId === project.id` and verifies that same match before any
revoke/delete — the IDOR guard that keeps an admin on project A from touching a token that
happens to belong to project B, even by guessing its id.

**Scopes are `catalog:read`/`catalog:write` only**, whitelisted by
`src/server/domain/project-token.ts` — a Glossa endpoint never lets a client hand Forge an
arbitrary scope string. `catalog:write` always implies `catalog:read`; the normalization
happens once, at token creation, so authorization checks stay a plain `hasScope`/
`hasAnyScope` call (`@forge-cms/auth`) with no extra "implies" branching at request time.

**`requireProjectMachineContext`** (`src/server/http/machine-http.ts`) is the one machine
auth boundary every `/api/machine/v1/*` route calls through. It authenticates via the same
`CompositeAuthAdapter`, then explicitly requires `role === 'machine'` — a human session that
happens to authenticate through the same composite is still rejected here, so a browser
cookie can never double as a machine credential. It reads `projectId` only from the token's
own trusted `metadata`, resolves the project, and returns scope helpers the routes use before
touching `CatalogService`. Machine writes reuse the exact same `CatalogService` a human save
does — same content validation, same configured-locale check, same project/locale/namespace
identity rules; there is no separate, looser write path for machines.

**Optimistic concurrency** is a `revision` column on `catalogs` (`src/server/cms/collections/
catalogs.ts`), regenerated by `CatalogService` on _every_ write — human UI save or machine
API write alike, so a stale reader is always detectable regardless of who wrote last. The
machine API surfaces it as a standard `ETag`/`If-Match` pair
(`saveCatalogWithPrecondition`, `CatalogRevisionConflictError` → `412`); the human UI save
route intentionally stays unpreconditioned (blind overwrite), matching its existing v1 UX —
its writes still advance the revision, so a subsequent stale machine write is still caught.

**Project deletion revokes every token bound to it** (`revokeAllProjectTokens`, called from
`project.service.ts`'s `deleteProject`) — a token can never remain usable against project
metadata that no longer resolves to anything.

Etyma is reserved for Glossa's own UI/runtime i18n. It should not become catalog-management domain logic, and Glossa-specific product behavior should not move into Etyma.

## Current Foundation

- `src/app/ui` contains small owned UI primitives following the Volt copy-and-own direction.
- `src/app/i18n` contains the initial catalog boundary while `@etyma/*` packages are unavailable on npm.
- `src/server/routes` contains Analog API route handlers.
- `src/server/domain` and `src/server/services` contain behavior that routes delegate to.
- `src/server/cms` centralizes ForgeCMS 0.4/D1 integration and schema-facing definitions.
- `users`, `projects`, and `catalogs` are registered with the ForgeCMS typed Local API.
- Human authentication uses Forge HttpOnly session cookies. Browser code never stores session tokens in localStorage or sessionStorage.
- `admin` and `editor` may mutate projects/catalogs. `viewer` is read-only.
- Project deletion and locale removal are restricted when they would silently lose catalog data.
- Only `admin` may create/list/revoke/delete a project's access tokens; a machine token can
  never manage another token.
- The machine API lives under `/api/machine/v1/*`, entirely separate from the human
  `/api/projects/*` routes, and requires a machine (`role: 'machine'`) principal — see
  `docs/MACHINE_API.md`.
