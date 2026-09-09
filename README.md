# Glossa

Glossa is a translation management product for managing JSON i18n catalogs across software projects.

The project is in an early production-foundation stage. The current repository implements authenticated project CRUD, project locale configuration, JSON catalog editing for the default namespace, ForgeCMS-backed persistence, and a Cloudflare D1 production target. It does not yet implement a complete TMS, API tokens, completeness analysis, AI translation, import/export, or distribution endpoints.

## Architecture

Glossa is a single Analog.js application:

```text
Angular / Analog UI
  -> Glossa API routes
  -> Glossa domain and services
  -> ForgeCMS typed Local API
  -> Cloudflare D1
```

ForgeCMS provides the generic CMS/data foundation beneath Glossa. It is infrastructure, not Glossa's external API contract. Etyma is intended to power Glossa's own UI i18n once the requested `@etyma/*` packages are available on npm.

Glossa's primary sign-in is "Continue with DevAuth" — a short OAuth 2.1/OIDC redirect to DevAuth, an external identity provider. Glossa keeps its own `users` collection, `admin`/`editor`/`viewer` roles, and its own opaque application session; DevAuth only answers "who is this." Local email/password sign-in remains available as a break-glass fallback. See `docs/ARCHITECTURE.md` for the full flow.

## Stack

- Analog.js with Angular 22 and Vite
- Standalone, zoneless, signal-first Angular
- Tailwind CSS 4 semantic tokens
- Volt-style owned UI primitives in `src/app/ui`
- Lumen Icons
- Angular Movement
- ForgeCMS packages from npm
- Cloudflare Pages with a D1 binding named `DB`
- DevAuth OAuth 2.1/OIDC SSO as the primary sign-in, with HttpOnly cookie sessions backed by the ForgeCMS users collection
- Vitest and Playwright

## Prerequisites

- Node >= 22
- pnpm 10.30.1

## Install

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

The dev server runs at `http://localhost:5173`.

For authenticated local development, set `AUTH_SECRET` and `BOOTSTRAP_ADMIN_KEY` in your local environment or `.dev.vars`. The in-memory development runtime may use Forge's dev signing secret when `AUTH_SECRET` is absent, but production D1 runtime requires `AUTH_SECRET`.

Create the first administrator once:

```bash
curl -X POST http://localhost:5173/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -H 'x-glossa-bootstrap-key: your-bootstrap-key' \
  -d '{"email":"admin@example.com","password":"change-this-password","name":"Admin"}'
```

The bootstrap route is unusable without `BOOTSTRAP_ADMIN_KEY` and returns a conflict after the first user exists.

### DevAuth SSO

1. Register Glossa as a client on your DevAuth provider (client id, client secret, and the
   exact redirect URI `<origin>/api/auth/sso/callback` — DevAuth matches redirect URIs
   byte for byte, no wildcards).
2. Put `DEV_AUTH_ISSUER`, `DEV_AUTH_CLIENT_ID`, `DEV_AUTH_CLIENT_SECRET`, and
   `DEV_AUTH_REDIRECT_URI` in `.dev.vars` (see `.env.example` for the shape). `pnpm dev`
   loads that file automatically; it is gitignored, so the secret never lands in a commit.
3. Open `/signin` and choose "Continue with DevAuth." That's it — no bootstrap step, no
   password.

The first person to sign in through DevAuth becomes Glossa's `admin`; anyone after that is
provisioned as a `viewer` for an admin to promote. If a Glossa user already exists with the
same email (a bootstrapped admin, say), that account is adopted instead of duplicated. From
the first sign-in onwards the identity is keyed on the provider's stable subject, so a later
change to the email at DevAuth never moves the link.

Glossa deliberately does not run its own second gate on _who_ may sign in: DevAuth already
decides that, applying its signup allowlist to every account-creation path and failing
closed. Glossa's own decision is _what_ a person may do, which is the role on their user
row. Revoking someone's access therefore means removing them at DevAuth — deleting their
Glossa user drops their role and kills their sessions immediately, but does not stop them
signing in again.

Local email/password sign-in stays available under "Use local credentials" as a
break-glass fallback if DevAuth is unavailable, and the `BOOTSTRAP_ADMIN_KEY` route above
still works for creating an admin without a provider.

## Testing

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
pnpm check
```

`pnpm check` runs formatting, linting, type checking, unit tests, and a production build.

## Cloudflare

Build for Cloudflare Pages:

```bash
pnpm build:cf
```

Preview locally with Wrangler:

```bash
pnpm preview:cf
```

`wrangler.jsonc` includes a placeholder D1 database ID. After creating the database, replace the placeholder with the real ID:

```bash
pnpm exec wrangler d1 create glossa
```

Do not commit Cloudflare secrets. Use dashboard configuration or `.dev.vars` locally for secrets when the app actually needs them.

### Deployment

`.github/workflows/deploy.yml` deploys to Cloudflare Pages on every push to `main` (and on
manual dispatch): it runs `pnpm check`, then `pnpm build:cf`, then
`wrangler pages deploy dist/analog/public`. There is no D1 migration step — ForgeCMS syncs
the schema itself through `runtime.syncSchema()`.

One-time setup before the first deploy:

1. Create the D1 database and keep the binding name `DB`:
   `pnpm exec wrangler d1 create glossa`.
2. **Replace the placeholder `database_id` in `wrangler.jsonc` with the real one.** It ships
   as all zeros, which is not a real database.
3. Create the Pages project (named `glossa`, matching `wrangler.jsonc`) and bind `DB` to
   that D1 database in its settings.
4. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets,
   visible to the `production` environment. The token needs Pages edit and D1 access.
5. On the Pages project, set `DEV_AUTH_ISSUER`, `DEV_AUTH_CLIENT_ID`, and
   `DEV_AUTH_REDIRECT_URI` as variables, and `DEV_AUTH_CLIENT_SECRET` plus `AUTH_SECRET` as
   **secrets** (never committed). The redirect URI must match the one registered at DevAuth
   byte for byte — that provider does no wildcard matching.
6. Point the Pages project at the domain whose callback URL you registered, so
   `DEV_AUTH_REDIRECT_URI` and the deployed origin agree.
7. Optionally set `BOOTSTRAP_ADMIN_KEY` if you also want a password-based admin; SSO alone
   does not need one.

After the first deploy, hit `/api/health`, then sign in with "Continue with DevAuth" — the
first sign-in becomes the admin.

## Environment

See `.env.example`. Required production values are `AUTH_SECRET` and, only during
first-admin setup, `BOOTSTRAP_ADMIN_KEY` — both remain Glossa's own local Forge
auth/session fallback, unrelated to DevAuth. DevAuth SSO additionally requires
`DEV_AUTH_ISSUER`, `DEV_AUTH_CLIENT_ID`, `DEV_AUTH_CLIENT_SECRET` (secret, server-only —
never exposed to Angular, never logged), and `DEV_AUTH_REDIRECT_URI`.

## Repository Structure

```text
src/app        Angular UI, layout, UI primitives, i18n catalog boundary
src/server     API routes, Glossa domain/services, ForgeCMS integration
docs           Architecture and roadmap notes
e2e            Playwright smoke tests
```

## Scripts

- `pnpm dev` starts Vite.
- `pnpm build` builds the Analog app.
- `pnpm build:cf` builds with the Cloudflare Pages preset.
- `pnpm preview` runs the built Analog server.
- `pnpm preview:cf` previews the Pages output through Wrangler.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm e2e` run quality checks.
- `pnpm format` and `pnpm format:check` run Prettier.
- `pnpm check` runs the local quality gate.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT. See `LICENSE`.
