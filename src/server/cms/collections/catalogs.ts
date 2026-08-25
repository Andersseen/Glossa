import { defineCollection, defineField } from '@forge-cms/core';

export interface CatalogContent {
  [key: string]: string | CatalogContent;
}

export type CatalogRecord = {
  project: string;
  locale: string;
  namespace?: string;
  content: CatalogContent;
};

export const catalogsCollection = defineCollection({
  slug: 'catalogs',
  fields: {
    project: defineField.relation({ collection: 'projects', required: true }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text(),
    content: defineField.json({ required: true }),
  },
});

export function validateCatalogRecord(catalog: CatalogRecord): CatalogRecord {
  if (!catalog.project.trim()) {
    throw new Error('Catalog project is required.');
  }

  if (!catalog.locale.trim()) {
    throw new Error('Catalog locale is required.');
  }

  if (Object.keys(catalog.content).length === 0) {
    throw new Error('Catalog content cannot be empty.');
  }

  return catalog;
}
