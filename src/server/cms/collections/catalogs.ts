import { defineCollection, defineField } from '@forge-cms/core';

export const catalogsCollection = defineCollection({
  slug: 'catalogs',
  fields: {
    project: defineField.relation({ collection: 'projects', required: true }),
    locale: defineField.text({ required: true }),
    namespace: defineField.text(),
    content: defineField.json({ required: true }),
  },
});
