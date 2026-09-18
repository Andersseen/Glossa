import type { GlossaCmsRuntime } from '../cms/runtime';
import { ProjectValidationError } from '../domain/project';
import { compareSourceKeySets } from '../domain/translation-tree';
import { listCatalogs } from './catalog.service';
import { listProjectTokens } from './project-token.service';
import { getProjectBySlug } from './project.service';
import { loadCatalogs } from './translation-workspace.service';

/**
 * Read-only impact previews for the two project-settings operations that deserve a "look before
 * you leap": moving the source locale and deleting a project. Neither writes anything — the writes
 * live in `project.service.ts` (`updateProject`/`deleteProject`), which re-validate on their own
 * rather than trusting that a preview was ever shown.
 */

export type SourceLocalePreview = {
  currentSourceLocale: string;
  nextSourceLocale: string;
  /** `false` when the candidate is already the source locale — an empty, always-allowed no-op. */
  changed: boolean;
  /** Whether the project has any catalog at all; with none, a source change is always allowed. */
  hasCatalogs: boolean;
  currentSourceCatalogExists: boolean;
  nextSourceCatalogExists: boolean;
  /** Mirrors the `updateProject` guard: catalogs exist but the candidate has none → `false`. */
  canChange: boolean;
  currentSourceKeys: number;
  nextSourceKeys: number;
  addedCanonicalKeys: string[];
  removedCanonicalKeys: string[];
};

/**
 * How moving the project's source locale to `candidateLocale` would change its canonical key set,
 * computed from one catalog load and the same addressable-key semantics as the Workspace and
 * Analysis (`compareSourceKeySets` → `flattenCatalogLeaves`).
 */
export async function previewSourceLocaleChange(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  candidateLocale: unknown,
): Promise<SourceLocalePreview> {
  const project = await getProjectBySlug(cms, projectSlug);

  if (typeof candidateLocale !== 'string' || !candidateLocale.trim()) {
    throw new ProjectValidationError('Source locale is required.');
  }

  const nextSourceLocale = candidateLocale.trim();

  if (!project.locales.includes(nextSourceLocale)) {
    throw new ProjectValidationError(
      `Locale "${nextSourceLocale}" is not configured for this project.`,
    );
  }

  const { contents } = await loadCatalogs(cms, project);
  const current = contents.get(project.sourceLocale);
  const next = contents.get(nextSourceLocale);
  const changed = nextSourceLocale !== project.sourceLocale;
  const hasCatalogs = contents.size > 0;

  return {
    currentSourceLocale: project.sourceLocale,
    nextSourceLocale,
    changed,
    hasCatalogs,
    currentSourceCatalogExists: current !== undefined,
    nextSourceCatalogExists: next !== undefined,
    canChange: !changed || !hasCatalogs || next !== undefined,
    ...compareSourceKeySets(current, next),
  };
}

export type ProjectDeletionImpact = {
  project: { id: string; slug: string; name: string };
  locales: string[];
  /** Locales that currently have a catalog — the ones deletion would remove. */
  catalogLocales: string[];
  catalogs: number;
  /** Counts only — never a token secret, and never more than the admin-only token list already shows. */
  accessTokens: { total: number; active: number };
  publicDelivery: boolean;
};

/** What deleting the project would remove, for the confirmation step — factual counts only. */
export async function getProjectDeletionImpact(
  cms: GlossaCmsRuntime,
  projectSlug: string,
): Promise<ProjectDeletionImpact> {
  const project = await getProjectBySlug(cms, projectSlug);
  const catalogs = await listCatalogs(cms, projectSlug);
  const tokens = await listProjectTokens(cms, project);

  return {
    project: { id: project.id, slug: project.slug, name: project.name },
    locales: project.locales,
    catalogLocales: catalogs.map((catalog) => catalog.locale),
    catalogs: catalogs.length,
    accessTokens: {
      total: tokens.length,
      active: tokens.filter((token) => token.status === 'active').length,
    },
    publicDelivery: project.publicDelivery,
  };
}
