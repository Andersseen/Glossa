import { defineCollection, defineField } from '@forge-cms/core';

/**
 * Maps a DevAuth identity (`provider` + `subject`) to a Glossa user. Internal/system collection —
 * never exposed through a product API, so access is locked to nobody on the checked path; every real
 * read/write here goes through trusted server code in `services/external-identity.service.ts`, which
 * uses the Local API's default `overrideAccess: true`.
 */
export const externalIdentitiesCollection = defineCollection({
  slug: 'external_identities',
  fields: {
    provider: defineField.text({ required: true }),
    subject: defineField.text({ required: true }),
    user: defineField.relation({
      collection: 'users',
      required: true,
      onDelete: 'cascade',
    }),
    emailSnapshot: defineField.text(),
  },
  indexes: [{ fields: ['provider', 'subject'], unique: true }],
  access: { read: [], create: [], update: [], delete: [] },
});
