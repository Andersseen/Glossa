# Static Consumer Deploy Hooks

A runtime consumer (Volt UI through Etyma's remote mode) fetches Glossa's
[Public Delivery](PUBLIC_DELIVERY.md) JSON while it runs, so a translation edit is visible as soon
as the edge cache refreshes. A **static** consumer is different. `my-blog` is Astro SSG: it reads
the Glossa catalogs during `astro build` and bakes them into HTML. Changing `Home` → `Inicio` in
Glossa updates Public Delivery, but the deployed HTML stays the same until the site is **rebuilt
and redeployed**.

Glossa handles this on the control-plane side. The consumer does not poll, run sync scripts,
switch to SSR, fetch translations in the browser, or install a Glossa client. It keeps running its
normal build, and Glossa tells the host to start one:

```text
Glossa edit ──► D1 ──► Public Delivery
     │
     └──► Cloudflare deploy hook ──► build (reads Glossa JSON) ──► static deploy
```

## V1 scope

- **Zero or one hook per project**, stored in the `deploy_hooks` Forge collection. A unique
  database index on `project` enforces this; it is not only checked in the service.
- **Cloudflare only.** Both current hook URL shapes are accepted:
  - Workers Builds: `https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/<id>`
  - Pages: `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/<id>`
- Best-effort, asynchronous delivery. Glossa records only the **last** delivery status. There is
  no retry queue and no delivery history.

## Configuring a hook

1. In Cloudflare, go to **Workers & Pages → your project → Settings → Builds → Deploy Hooks**,
   create a hook, and copy its URL.
2. In Glossa, open the project and go to **Delivery → Static site rebuild → Configure Cloudflare
   hook**. Paste the URL and click **Save hook**.
3. Click **Test hook** to confirm that Cloudflare starts a build.

Only an **admin** can see or manage the hook. Editors and viewers see a one-line note, and the
management API refuses them.

### Management API (admin only)

| Method   | Path                                   | Purpose                                                   |
| -------- | -------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/api/projects/:slug/deploy-hook`      | Masked view (`{ deployHook: { configured, … } }`)         |
| `PUT`    | `/api/projects/:slug/deploy-hook`      | Create (`{ url, enabled?, provider? }`), or update        |
| `DELETE` | `/api/projects/:slug/deploy-hook`      | Remove the hook config only (not the project or catalogs) |
| `POST`   | `/api/projects/:slug/deploy-hook/test` | Call the hook now and wait for the answer                 |

- The project comes from `:slug` only. A `project`/`projectId` field in the body is ignored.
- Once a hook exists, `PUT { "enabled": false }` toggles it without re-sending the URL.
  `PUT { "url": "<new full URL>" }` replaces it and resets the last-delivery status.
- `POST …/test` calls the hook even if it is disabled, because the admin asked for it. It returns
  `200` with `{ success, statusCode?, error?, attemptedAt, deployHook }`. A failed delivery is
  still a `200`, because the test itself ran.
- Editors, viewers and unauthenticated callers are refused (`403`/`401`). Project machine tokens
  are refused too, because a machine principal never passes the human auth boundary.

## The URL is a secret

Anyone with a deploy-hook URL can start a build, so Glossa treats the URL as a credential:

- It is **never returned after saving**. Every response contains only a mask such as
  `https://api.cloudflare.com/…/deploy_hooks/••••••C123` (the last four characters of the
  identifier). The original URL cannot be recovered from the mask.
- It does not appear in `GET /api/projects/:slug`, the workspace, the Public Delivery manifest,
  the Machine API, MCP, error messages, logs or SSR state. Validation errors never echo the
  submitted URL.
- **Storage:** the URL is stored server-side in D1, **in plain text**. ForgeCMS has no
  application-level field encryption, and Glossa does not claim any. The collection's Forge
  access rules are locked to nobody, and only `deploy-hook.service.ts` reads it through the Local
  API. If a hook URL leaks, delete it in Cloudflare and replace it in Glossa.

### SSRF protection

Glossa makes the outbound request itself, so it accepts URLs from an allowlist, not a denylist.
The URL must:

- use `https:`
- have the hostname exactly `api.cloudflare.com`, with the default port
- contain no credentials, query string or fragment
- have a `/client/v4/…/deploy_hooks/<id>` path ending in one opaque identifier (8–128 of
  `A–Z a–z 0–9 _ -`)

IP literals (`127.0.0.1`, `[::1]`, `169.254.169.254`), `localhost`, look-alike domains and
non-hook Cloudflare API paths are rejected. Redirects are not followed (`redirect: 'manual'`, and
a 3xx counts as a failure), so the validated host is the only host Glossa ever contacts. Tests do
not weaken this validation. Playwright intercepts the browser's `…/test` call, and Vitest stubs
`fetch`.

## What triggers a build

Glossa sends **one** POST per successful **logical** operation, not one per catalog written.
Renaming a key across `es`/`en`/`uk` is three catalog writes but one build. Importing three files
is also one build. The trigger runs in the route after the operation succeeds, never inside
`saveCatalog`/`saveCatalogWithPrecondition`/`writeCatalog`.

| Operation                                                           | Builds |
| ------------------------------------------------------------------- | ------ |
| Workspace edit (`PATCH …/translations`), any number of locales      | 1      |
| Add translation (`POST …/translations`)                             | 1      |
| Rename key (`POST …/translations/rename`)                           | 1      |
| Delete key (`POST …/translations/delete`)                           | 1      |
| Catalog import commit (`POST …/catalogs/import`), any batch size    | 1      |
| Raw JSON catalog save (`PUT …/catalogs/:locale`)                    | 1      |
| Catalog delete (`DELETE …/catalogs/:locale`)                        | 1      |
| Machine API `PUT /api/machine/v1/catalogs/:locale`                  | 1      |
| MCP `set_translation` / `rename_translation` / `delete_translation` | 1 each |
| Project settings: source locale or configured locales changed       | 1      |

**No build is triggered by:**

- a failed or refused write: revision conflict, key collision, validation error, missing
  scope, unauthorized caller, or an import batch that fails preflight
- import preview, the workspace, analysis, or any read (`GET` routes, MCP `get_*`/`list_*`/
  `analyze_translations`/`get_delivery_urls`)
- a project **name**-only change or a `publicDelivery` toggle. Rebuilding right after you turn
  delivery off would only make the consumer's build fail. After you turn it back on, use
  **Test hook**.
- creating, revoking or deleting access tokens
- configuring, enabling, disabling, replacing or removing the hook (only **Test hook** calls it)
- deleting the project: the hook configuration is removed with the project and is **not** called

If a write fails part-way after a clean preflight (a rare race; see the lifecycle and import
docs), some catalogs did change. The operation still triggers one build, because published
content is different now.

A disabled hook, or a project without a hook, is a silent no-op.

## Delivery semantics

- `POST` to the stored URL with no body and no headers. Glossa sends no Glossa token, project
  token, Cloudflare API token or translation content, because the URL already is the credential.
- **5 second timeout** (`AbortController`).
- Any **2xx** is success. Anything else is a failure.
- The request runs in the **background**. On Cloudflare it is handed to the request's
  `event.context.waitUntil` through the shared `runInBackground` helper (also used by the edge
  cache). In `pnpm dev`, Node preview and Vitest, where `waitUntil` does not exist, the
  long-lived process simply lets it finish. The response to the translation change never waits
  for Cloudflare.
- **A provider failure never fails the content change.** If Cloudflare returns `500` or times
  out, the translation save still returns its normal success status, nothing is rolled back, and
  the failure is recorded on the hook.

### Last-delivery status

Only the most recent attempt is kept. There is no history table.

| Field            | On success   | On failure                                   |
| ---------------- | ------------ | -------------------------------------------- |
| `lastAttemptAt`  | now          | now                                          |
| `lastSuccessAt`  | now          | unchanged (previous success kept)            |
| `lastStatusCode` | the 2xx code | the HTTP code, or `null` for network/timeout |
| `lastError`      | `null`       | `http_error` / `network_error` / `timeout`   |

Glossa never stores or shows provider response bodies, stack traces or exception messages. It
keeps only the status code and one of those three categories.

## Not in V1

Retries (queues, cron, backoff, DLQ, Durable Objects, outbox), delivery history, multiple hooks
or providers, generic webhooks, GitHub `repository_dispatch`, Vercel/Netlify, Cloudflare API
tokens, automatic hook creation, deployment status polling, HMAC signatures, custom headers,
event selection, and MCP tools for configuring hooks. If dogfooding shows that retries are
needed, they belong in V2.
