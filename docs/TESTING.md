# Testing

| Layer          | Command        | Persistence                              | Runtime                   |
| -------------- | -------------- | ---------------------------------------- | ------------------------- |
| Unit / service | `pnpm test`    | Forge `InMemoryDatabaseAdapter`          | Node                      |
| D1 integration | `pnpm test:d1` | Forge `D1DatabaseAdapter`, real local D1 | `workerd` via Miniflare   |
| End to end     | `pnpm e2e`     | In-memory (Playwright runs `pnpm dev`)   | Browser + Vite dev server |

## D1 integration suite (`pnpm test:d1`)

Runs `test/d1/*.d1.test.ts` with `vitest.d1.config.ts` using `@cloudflare/vitest-plugin` — Cloudflare's
current, supported Workers Vitest integration (the successor to `@cloudflare/vitest-pool-workers`).
It is a separate Vitest config so the Angular/Node unit config (`vitest.config.ts`, which only
includes `src/**/*.spec.ts`) is untouched. No Cloudflare account, token or manual setup is needed.

**What runs on D1:** Glossa's real services against `createCmsRuntime({ DB })`, the same code path
production takes when the `DB` binding exists. Nothing about D1 is mocked.

**Covered**

- Projects: schema sync, create, read via an independent runtime, settings update, slug uniqueness,
  rejected operations leaving data intact.
- Catalogs: create, read via another runtime, nested JSON update, revision change per write, list by
  project, the `(project, locale, namespace)` unique index (hit directly, bypassing the service),
  unconfigured-locale rejection, delete.
- Optimistic concurrency, **sequential only**: write with the current revision advances it; a stale
  revision is rejected and the newer content survives; create-only (`If-None-Match: *`) and
  revision-less writes to an existing catalog are rejected.
- Relations/lifecycle: `restrict` on project→catalog, a catalog cannot point at a missing project, a
  locale with a catalog cannot be dropped, deleting one project leaves others, and a deterministic
  injected mid-delete failure leaves the project in place and retryable.
- Auth: Forge users and password login persist; project tokens are scoped to their project, authenticate
  from a fresh runtime, cross-project revoke/delete is refused, revocation persists, and deleting a
  project revokes only its own tokens.
- Public delivery: manifest/catalog track updates, and stop after disable and after delete.

Every read that proves persistence goes through a **new** runtime (`openRuntime()` in
`test/d1/harness.ts`), so an in-memory-only implementation cannot pass. `openRuntime()` throws if the
`DB` binding is missing or the adapter is not `D1DatabaseAdapter`; it never falls back to memory.

**How the database is created and reset.** `vitest.d1.config.ts` declares a Miniflare `d1Databases`
binding named `DB` inline. Miniflare creates a local SQLite-backed D1 for each run (no persistence path is configured, so
nothing is written to the repo); nothing is created manually. Before every test the harness
drops all user tables, then the application's own `syncSchema()` rebuilds the schema from empty, so
tests are order-independent and each run starts from nothing.

**Why it cannot reach production.** The config does not read `wrangler.jsonc` (which holds the real
database id) — it passes its own inline binding whose value is only a local persistence key, with no
`remote` option, so Miniflare never contacts Cloudflare. No secret or token is read; the harness sets a
throwaway `AUTH_SECRET`.

**Differences.** Unlike the in-memory specs, it exercises the real SQL layer (D1 schema sync, unique
indexes, relations, JSON columns) in the Workers runtime. Unlike Playwright, it does not drive the UI,
HTTP routes or the Pages bundle; it calls services directly.

**Not covered:** simultaneous writers (the revision check is read-check-write, not atomic — a known
issue deferred to a later milestone), catalog import, translation workspace/lifecycle services, deploy
hooks, SSO sessions, HTTP/MCP handlers, and the built `_worker.js` on Pages.

**CI enforcement.** `ci.yml` has a `d1` job running `pnpm test:d1` on pull requests and pushes to
`main`. `pnpm check` also runs it, and `deploy.yml`'s `verify` job runs `pnpm check`, so a failing D1
suite blocks the production `deploy` job (`needs: verify`).
