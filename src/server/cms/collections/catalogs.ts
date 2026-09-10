import { defineCollection, defineField } from '@forge-cms/core';

import type { CatalogContent } from '../../domain/catalog';

export const catalogsCollection = defineCollection({
  slug: 'catalogs',
  fields: {
    project: defineField.relation({
      collection: 'projects',
      required: true,
      onDelete: 'restrict',
    }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text(),
    content: defineField.json<CatalogContent>({ required: true }),
    // Opaque optimistic-concurrency token: regenerated on every write (human or machine) so a
    // stale writer can detect it lost a race — see `CatalogService`'s revision generation.
    revision: defineField.text({ required: true }),
    updatedAt: defineField.text({ required: true }),
  },
  indexes: [{ fields: ['project', 'locale', 'namespace'], unique: true }],
});
