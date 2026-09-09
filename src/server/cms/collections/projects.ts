import { defineCollection, defineField } from '@forge-cms/core';

import { validateProjectInput, type ProjectInput } from '../../domain/project';

export const projectsCollection = defineCollection({
  slug: 'projects',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({ required: true, unique: true }),
    sourceLocale: defineField.text({ required: true }),
    locales: defineField.json<string[]>({ required: true }),
  },
});

export function validateProjectRecord(project: ProjectInput) {
  return validateProjectInput(project);
}
