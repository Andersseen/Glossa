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

1. Bootstrap the first Glossa admin as above.
2. Make sure that admin's email matches an account on your DevAuth provider.
3. Set `DEV_AUTH_ISSUER`, `DEV_AUTH_CLIENT_ID`, `DEV_AUTH_CLIENT_SECRET`, and
   `DEV_AUTH_REDIRECT_URI` (see `.env.example`) — DevAuth must have a matching client
   registration for these values (client id, redirect URI, secret).
4. Open `/signin` and choose "Continue with DevAuth." The first successful sign-in links
   your DevAuth identity to that existing Glossa admin by exact email match; every sign-in
   after that uses the linked identity, not email. An unrecognized DevAuth identity is
   denied with a clear message rather than creating a new account.

Local email/password sign-in stays available under "Use local credentials" as a
break-glass fallback if DevAuth is unavailable.

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

Production deployment checklist:

1. Create a D1 database and keep the binding name `DB`.
2. Replace the placeholder `database_id` in `wrangler.jsonc` with the real database ID.
3. Set `AUTH_SECRET` as a Cloudflare Pages secret.
4. Temporarily set `BOOTSTRAP_ADMIN_KEY` for first-admin creation.
5. Set `DEV_AUTH_ISSUER`, `DEV_AUTH_CLIENT_ID`, and `DEV_AUTH_REDIRECT_URI` as Cloudflare
   Pages variables, and `DEV_AUTH_CLIENT_SECRET` as a Cloudflare Pages **secret** (never
   commit it). The redirect URI's exact production value needs maintainer input — DevAuth
   matches redirect URIs exactly, no wildcards.
6. Run `pnpm build:cf`.
7. Deploy through the existing Cloudflare Pages/Analog output.
8. Hit `/api/health`, bootstrap the first admin, confirm "Continue with DevAuth" links
   that admin's account, then remove or rotate the bootstrap key.

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
