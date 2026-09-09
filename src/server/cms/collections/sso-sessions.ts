import { defineCollection, defineField } from '@forge-cms/core';

/**
 * Glossa's own opaque application session for DevAuth-originated sign-ins. Only `tokenHash` is
 * stored — never the raw token. Internal/system collection, same locked access as
 * `external_identities`; read/written by `GlossaSsoAuthAdapter` (raw `DatabaseAdapter`, for
 * validation) and `services/sso-session.service.ts` (Local API, for create/revoke).
 */
export const ssoSessionsCollection = defineCollection({
  slug: 'sso_sessions',
  fields: {
    tokenHash: defineField.text({ required: true, unique: true }),
    user: defineField.relation({
      collection: 'users',
      required: true,
      onDelete: 'cascade',
    }),
    provider: defineField.text(),
    expiresAt: defineField.date({ required: true, withTime: true }),
  },
  access: { read: [], create: [], update: [], delete: [] },
});
