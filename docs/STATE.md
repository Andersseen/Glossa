# Current State

Glossa is a single Analog.js application backed by ForgeCMS 0.4.x public npm packages.

## Implemented

- Project CRUD with required name, unique slug, source locale, and locale list validation.
- JSON catalog list/get/save/delete for the default internal namespace.
- ForgeCMS collections: `users`, `projects`, and `catalogs`.
- Browser authentication through Forge HttpOnly session cookies.
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
