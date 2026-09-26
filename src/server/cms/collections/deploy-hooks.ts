import { defineCollection, defineField } from '@forge-cms/core';

/**
 * At most one static-consumer deploy hook per project (`project` is `unique` — enforced by the
 * database index, not only by the service). `onDelete: 'restrict'` means a project record can never
 * be deleted while its hook still exists, so `deleteProject` must remove it first and an orphaned
 * secret cannot outlive its project.
 *
 * `url` is the deploy credential itself, stored server-side in plain text: Forge has no
 * application-level field encryption and none is claimed. Access is locked to nobody on the
 * checked path (same as `sso_sessions`); only `deploy-hook.service.ts` reads it, through the Local
 * API, and never serializes it.
 */
export const deployHooksCollection = defineCollection({
  slug: 'deploy_hooks',
  fields: {
    project: defineField.relation({
      collection: 'projects',
      required: true,
      unique: true,
      onDelete: 'restrict',
    }),
    provider: defineField.text({ required: true }),
    url: defineField.text({ required: true }),
    enabled: defineField.boolean(),
    createdAt: defineField.text({ required: true }),
    updatedAt: defineField.text({ required: true }),
    lastAttemptAt: defineField.text(),
    lastSuccessAt: defineField.text(),
    lastStatusCode: defineField.number(),
    lastError: defineField.text(),
  },
  access: { read: [], create: [], update: [], delete: [] },
});
