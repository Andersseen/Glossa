import type { GlossaCmsRuntime } from '../cms/runtime';
import type { CatalogContent } from '../domain/catalog';
import type { Project } from '../domain/project';
import {
  deleteTranslationValue,
  getTranslationValue,
  InvalidTranslationKeyError,
  parseTranslationKeyPath,
  pathExists,
  renameTranslationValue,
  TranslationKeyCollisionError,
} from '../domain/translation-path';
import {
  isCatalogServiceError,
  saveCatalogWithPrecondition,
} from './catalog.service';
import { getProjectBySlug } from './project.service';
import {
  loadCatalogs,
  readExpectedRevisions,
  requireKey,
  TranslationValidationError,
  type LoadedCatalogs,
  type TranslationCatalogState,
} from './translation-workspace.service';

export class TranslationNotFoundError extends Error {
  readonly code = 'TRANSLATION_NOT_FOUND';

  constructor() {
    super('Translation key not found in the source locale.');
  }
}

/**
 * Thrown by the preflight when any *existing* project catalog's revision does not match the
 * caller's `expectedRevisions` — see `preflightRevisions`. Distinct from the single-locale
 * `CatalogRevisionConflictError` the value-edit path uses: a lifecycle operation touches every
 * configured locale at once, so a caller needs to know every locale that is stale, not just the
 * first one found.
 */
export class TranslationLifecycleConflictError extends Error {
  readonly code = 'CATALOG_REVISION_CONFLICT';
  readonly conflicts: Record<string, string | null>;

  constructor(conflicts: Record<string, string | null>) {
    super(
      'Translations changed after they were loaded. Reload before continuing.',
    );
    this.conflicts = conflicts;
  }
}

export type RenameTranslationKeyInput = {
  key?: unknown;
  newKey?: unknown;
  expectedRevisions?: unknown;
};

export type DeleteTranslationKeyInput = {
  key?: unknown;
  expectedRevisions?: unknown;
};

export type TranslationLifecycleWriteResult =
  | { locale: string; status: 'saved'; revision: string }
  | {
      locale: string;
      status: 'failed';
      error: { code: string; message: string };
    };

export type TranslationLifecycleResponse = {
  operation: 'rename' | 'delete';
  key: string;
  newKey?: string;
  saved: boolean;
  /** Only locales an actual write was attempted for — a locale that never had the key is silent. */
  results: TranslationLifecycleWriteResult[];
  catalogs: Record<string, TranslationCatalogState>;
};

export function isTranslationLifecycleServiceError(
  error: unknown,
): error is
  | TranslationValidationError
  | TranslationNotFoundError
  | TranslationKeyCollisionError
  | TranslationLifecycleConflictError
  | InvalidTranslationKeyError {
  return (
    error instanceof TranslationValidationError ||
    error instanceof TranslationNotFoundError ||
    error instanceof TranslationKeyCollisionError ||
    error instanceof TranslationLifecycleConflictError ||
    error instanceof InvalidTranslationKeyError
  );
}

/**
 * Renames a canonical source key across every existing project catalog in one logical operation.
 * The whole operation is preflighted — revisions, source-key existence, and a project-wide
 * collision check on `newKey` — before any catalog is written, so a predictable failure never
 * leaves some locales renamed and others not. See `writeAcrossCatalogs` for what happens if a
 * write still fails after a clean preflight (a genuine race, not a rollback).
 */
export async function renameProjectTranslationKey(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  input: RenameTranslationKeyInput,
): Promise<TranslationLifecycleResponse> {
  const project = await getProjectBySlug(cms, projectSlug);
  const key = requireKey(input.key);
  const newKey = requireKey(input.newKey, 'New translation key');

  if (key === newKey) {
    throw new TranslationValidationError(
      'The new key must be different from the current key.',
    );
  }

  const oldPath = parseTranslationKeyPath(key);
  const newPath = parseTranslationKeyPath(newKey);
  const expectedRevisions = readExpectedRevisions(input.expectedRevisions);

  const loaded = await loadCatalogs(cms, project);
  preflightRevisions(loaded, expectedRevisions);
  requireSourceKeyExists(loaded, project.sourceLocale, oldPath);
  requireNoCollision(loaded, newPath, newKey);

  const results = await writeAcrossCatalogs(cms, project, loaded, (content) =>
    renameTranslationValue(content, oldPath, newPath),
  );

  return {
    operation: 'rename',
    key,
    newKey,
    saved: results.every((result) => result.status === 'saved'),
    results,
    catalogs: await refreshCatalogStates(cms, project),
  };
}

/**
 * Deletes a canonical source key from every existing project catalog that has it. A target locale
 * that never had the key, or a configured locale with no catalog at all, is left exactly as is —
 * neither is an error.
 */
export async function deleteProjectTranslationKey(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  input: DeleteTranslationKeyInput,
): Promise<TranslationLifecycleResponse> {
  const project = await getProjectBySlug(cms, projectSlug);
  const key = requireKey(input.key);
  const path = parseTranslationKeyPath(key);
  const expectedRevisions = readExpectedRevisions(input.expectedRevisions);

  const loaded = await loadCatalogs(cms, project);
  preflightRevisions(loaded, expectedRevisions);
  requireSourceKeyExists(loaded, project.sourceLocale, path);

  const results = await writeAcrossCatalogs(cms, project, loaded, (content) =>
    deleteTranslationValue(content, path),
  );

  return {
    operation: 'delete',
    key,
    saved: results.every((result) => result.status === 'saved'),
    results,
    catalogs: await refreshCatalogStates(cms, project),
  };
}

/**
 * Every *existing* project catalog must have a matching `expectedRevisions` entry — not just the
 * locales the operation will actually touch — because the human/agent workspace loaded all of
 * them, and a stale read on any one means the whole operation is working from outdated state. A
 * locale with no catalog needs no revision; one whose catalog disappeared since the caller read it
 * is itself a conflict (`null`).
 */
function preflightRevisions(
  loaded: LoadedCatalogs,
  expectedRevisions: Record<string, string>,
): void {
  const conflicts: Record<string, string | null> = {};

  for (const [locale, state] of Object.entries(loaded.states)) {
    if (state.exists) {
      if (!state.revision || expectedRevisions[locale] !== state.revision) {
        conflicts[locale] = state.revision ?? null;
      }
    } else if (expectedRevisions[locale]) {
      conflicts[locale] = null;
    }
  }

  if (Object.keys(conflicts).length > 0) {
    throw new TranslationLifecycleConflictError(conflicts);
  }
}

function requireSourceKeyExists(
  loaded: LoadedCatalogs,
  sourceLocale: string,
  path: string[],
): void {
  const sourceContent = loaded.contents.get(sourceLocale);

  if (
    !sourceContent ||
    getTranslationValue(sourceContent, path) === undefined
  ) {
    throw new TranslationNotFoundError();
  }
}

/**
 * The new key must be free in *every* existing catalog, including a target locale's orphan key the
 * source locale does not define — better safe than silently destructive.
 */
function requireNoCollision(
  loaded: LoadedCatalogs,
  newPath: string[],
  newKey: string,
): void {
  for (const content of loaded.contents.values()) {
    if (pathExists(content, newPath)) {
      throw new TranslationKeyCollisionError(newKey);
    }
  }
}

/**
 * Applies `transform` to every existing catalog and writes only the ones it actually changed,
 * through the same `saveCatalogWithPrecondition` every other write path uses — no direct D1 access
 * and no invented transaction. By the time this runs, `preflightRevisions` has already confirmed
 * every precondition will hold; a failure here means a genuine race in that narrow window, and is
 * reported per locale rather than assumed to have rolled back (nothing rolls back).
 */
async function writeAcrossCatalogs(
  cms: GlossaCmsRuntime,
  project: Project,
  loaded: LoadedCatalogs,
  transform: (content: CatalogContent) => CatalogContent,
): Promise<TranslationLifecycleWriteResult[]> {
  const results: TranslationLifecycleWriteResult[] = [];

  for (const locale of project.locales) {
    const content = loaded.contents.get(locale);
    const revision = loaded.states[locale]?.revision;

    if (!content || !revision) {
      continue;
    }

    try {
      const next = transform(content);

      if (next === content) {
        continue;
      }

      const catalog = await saveCatalogWithPrecondition(
        cms,
        project.slug,
        locale,
        next,
        { ifMatch: revision },
      );
      results.push({ locale, status: 'saved', revision: catalog.revision });
    } catch (error) {
      results.push({ locale, status: 'failed', error: toErrorDetail(error) });
    }
  }

  return results;
}

function toErrorDetail(error: unknown): { code: string; message: string } {
  if (
    error instanceof InvalidTranslationKeyError ||
    error instanceof TranslationKeyCollisionError ||
    isCatalogServiceError(error)
  ) {
    return { code: error.code, message: error.message };
  }

  throw error;
}

async function refreshCatalogStates(
  cms: GlossaCmsRuntime,
  project: Project,
): Promise<Record<string, TranslationCatalogState>> {
  return (await loadCatalogs(cms, project)).states;
}
