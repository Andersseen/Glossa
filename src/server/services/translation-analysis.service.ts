import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  analyzeTranslations,
  type TranslationAnalysis,
} from '../domain/translation-tree';
import { loadCatalogs } from './translation-workspace.service';
import { getProjectBySlug } from './project.service';

export type ProjectTranslationAnalysis = {
  project: {
    slug: string;
    name: string;
    sourceLocale: string;
    locales: string[];
  };
  analysis: TranslationAnalysis;
};

/**
 * The project-wide completeness/diff read: one project read, one catalog-list load (the same
 * `loadCatalogs` the workspace uses), then an in-memory key-set comparison — never one request
 * per key or per locale, and no second catalog-loading path to drift from the workspace's.
 */
export async function getTranslationAnalysis(
  cms: GlossaCmsRuntime,
  projectSlug: string,
): Promise<ProjectTranslationAnalysis> {
  const project = await getProjectBySlug(cms, projectSlug);
  const loaded = await loadCatalogs(cms, project);

  return {
    project: {
      slug: project.slug,
      name: project.name,
      sourceLocale: project.sourceLocale,
      locales: project.locales,
    },
    analysis: analyzeTranslations(
      project.sourceLocale,
      project.locales,
      loaded.contents,
    ),
  };
}
