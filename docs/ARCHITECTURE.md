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
       -> first-time link by exact, DevAuth-verified email match to an existing
          Glossa user (never auto-created)
  -> Glossa's own opaque session created (sso_sessions, SHA-256 token hash only)
  -> HttpOnly forge_session cookie
  -> /projects
```

DevAuth's access/refresh/ID tokens are discarded immediately after the `userinfo` call —
they are never persisted, never reach Angular, and never become Glossa's session.

`CompositeAuthAdapter([GlossaSsoAuthAdapter, UsersCollectionAuthAdapter])`
(`src/server/cms/runtime.ts`) is the single auth boundary every protected route already
calls through `requireAuth`/`requireWriteUser` — routes never branch on which strategy
authenticated the request. `GlossaSsoAuthAdapter.canHandleToken` recognizes the
`glossa_sso_...` prefix; a Forge password-signed token routes to
`UsersCollectionAuthAdapter` the same as before. Local email/password sign-in remains
available as a break-glass fallback if DevAuth is unavailable.

See `src/server/auth/` for the OIDC protocol boundary (discovery, PKCE, token exchange,
userinfo — no ID-token decoding; identity comes from an authenticated `userinfo` call
only) and `.env.example`/README.md for the required `DEV_AUTH_*` configuration.

ForgeCMS is infrastructure for Glossa. It provides generic CMS/data capabilities under the product, but its generic CRUD API is not Glossa's external API contract.

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
