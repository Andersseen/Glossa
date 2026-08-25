import { defineCollection, defineField } from '@forge-cms/core';

export type ProjectRecord = {
  name: string;
  slug: string;
  sourceLocale: string;
  locales: readonly string[];
};

export const projectsCollection = defineCollection({
  slug: 'projects',
  fields: {
    name: defineField.text({ required: true }),
    slug: defineField.slug({ required: true, unique: true }),
    sourceLocale: defineField.text({ required: true }),
    locales: defineField.json({ required: true }),
  },
});

export function validateProjectRecord(project: ProjectRecord): ProjectRecord {
  if (!project.name.trim()) {
    throw new Error('Project name is required.');
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.slug)) {
    throw new Error('Project slug must be lowercase kebab-case.');
  }

  if (!project.sourceLocale.trim()) {
    throw new Error('Source locale is required.');
  }

  if (!project.locales.includes(project.sourceLocale)) {
    throw new Error('Locales must include the source locale.');
  }

  return project;
}
