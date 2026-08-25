# Glossa

Glossa is a translation management platform for managing and distributing JSON i18n catalogs across software projects.

The project is in an early foundation stage. The current repository proves the application shell, server route layer, Cloudflare target, testing setup, and documentation shape. It does not yet implement project management, catalog editing, API tokens, completeness analysis, or distribution endpoints.

## Architecture

Glossa is a single Analog.js application:

```text
Angular / Analog UI
  -> Glossa API routes
  -> Glossa domain and services
  -> ForgeCMS runtime
  -> Cloudflare D1
```

ForgeCMS provides the generic CMS/data foundation beneath Glossa. It is infrastructure, not Glossa's external API contract. Etyma is intended to power Glossa's own UI i18n once the requested `@etyma/*` packages are available on npm.

## Stack

- Analog.js with Angular 22 and Vite
- Standalone, zoneless, signal-first Angular
- Tailwind CSS 4 semantic tokens
- Volt-style owned UI primitives in `src/app/ui`
- Lumen Icons
- Angular Movement
- ForgeCMS packages from npm
- Cloudflare Pages with a D1 binding named `DB`
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

## Environment

See `.env.example`. Only variables currently used by the app should be added there.

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
