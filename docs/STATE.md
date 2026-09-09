# Current State

Glossa is a single Analog.js application backed by ForgeCMS 0.4.x public npm packages.

## Implemented

- Project CRUD with required name, unique slug, source locale, and locale list validation.
- JSON catalog list/get/save/delete for the default internal namespace.
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

Project slugs are protected by a database unique constraint. Catalog identity is protected by a compound unique index on `project`, `locale`, and `namespace`.

Project deletion is restricted while catalogs exist. Removing a project locale is rejected when that locale already has catalog content.

## Deferred

Import/export, completeness and diff analysis, AI translation, translation memory, GitHub integration, teams, billing, API tokens, OAuth, comments, review workflow, namespaces UI, and distribution APIs are intentionally deferred.

## Next Milestone

Translation Catalog Import/Export + Completeness/Diff.
