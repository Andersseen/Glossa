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

ForgeCMS is infrastructure for Glossa. It provides generic CMS/data capabilities under the product, but its generic CRUD API is not Glossa's external API contract.

Etyma is reserved for Glossa's own UI/runtime i18n. It should not become catalog-management domain logic, and Glossa-specific product behavior should not move into Etyma.

## Current Foundation

- `src/app/ui` contains small owned UI primitives following the Volt copy-and-own direction.
- `src/app/i18n` contains the initial catalog boundary while `@etyma/*` packages are unavailable on npm.
- `src/server/routes` contains Analog API route handlers.
- `src/server/domain` and `src/server/services` contain behavior that routes delegate to.
- `src/server/cms` centralizes ForgeCMS/D1 integration and schema-facing definitions.
