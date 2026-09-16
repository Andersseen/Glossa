import type { GlossaCmsRuntime } from '../cms/runtime';
import type { CatalogContent } from '../domain/catalog';
import type { Project } from '../domain/project';
import {
  InvalidTranslationKeyError,
  getTranslationValue,
  parseTranslationKeyPath,
  setTranslationValue,
} from '../domain/translation-path';
import {
  buildTranslationEntries,
  countTargetOnlyKeys,
  summarizeTranslationEntries,
  type TranslationEntry,
  type TranslationSummary,
} from '../domain/translation-tree';
import {
  CatalogRevisionConflictError,
  isCatalogServiceError,
  listCatalogs,
  saveCatalogWithPrecondition,
  type CatalogWritePrecondition,
} from './catalog.service';
import { getProjectBySlug } from './project.service';

export class TranslationValidationError extends Error {
  readonly code = 'TRANSLATION_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

export class TranslationKeyExistsError extends Error {
  readonly code = 'TRANSLATION_KEY_EXISTS';

  constructor(key: string) {
    super(`Translation key "${key}" already exists in the source locale.`);
  }
}

export type TranslationCatalogState = {
  exists: boolean;
  revision?: string;
};

export type TranslationWorkspace = {
  project: {
    slug: string;
    name: string;
    sourceLocale: string;
    locales: string[];
  };
  catalogs: Record<string, TranslationCatalogState>;
  entries: TranslationEntry[];
  summary: TranslationSummary;
  /** Purely informational; no orphan-key management exists in this milestone. */
  diagnostics: {
    targetOnlyKeys: Record<string, number>;
  };
};

export type TranslationChangeInput = {
  locale?: unknown;
  value?: unknown;
  expectedRevision?: unknown;
};

export type TranslationUpdateInput = {
  key?: unknown;
  changes?: unknown;
};

export type TranslationCreateInput = {
  key?: unknown;
  values?: unknown;
  expectedRevisions?: unknown;
};

export type TranslationWriteResult =
  | { locale: string; status: 'saved'; revision: string }
  | {
      locale: string;
      status: 'failed';
      error: { code: string; message: string };
      currentRevision?: string | null;
    };

export type TranslationWriteResponse = {
  key: string;
  saved: boolean;
  results: TranslationWriteResult[];
  /**
   * The key re-read across every configured locale after the writes, plus the current revision of
   * every catalog — so one round trip leaves the client's revisions correct for the next edit,
   * with no second GET and no client-side guessing about what was stored.
   */
  entry: TranslationEntry | null;
  catalogs: Record<string, TranslationCatalogState>;
};

type NormalizedChange = {
  locale: string;
  value: string;
  expectedRevision?: string;
};

export type LoadedCatalogs = {
  contents: Map<string, CatalogContent>;
  states: Record<string, TranslationCatalogState>;
};

/**
 * The whole human workspace in one read: every source key, its value in every configured locale,
 * and each catalog's current revision. Derived entirely from `ProjectService`/`CatalogService` —
 * nothing here queries D1 directly, and no workspace-specific storage exists.
 */
export async function getTranslationWorkspace(
  cms: GlossaCmsRuntime,
  projectSlug: string,
): Promise<TranslationWorkspace> {
  const project = await getProjectBySlug(cms, projectSlug);
  const loaded = await loadCatalogs(cms, project);
  const entries = buildTranslationEntries(
    project.sourceLocale,
    project.locales,
    loaded.contents,
  );

  return {
    project: {
      slug: project.slug,
      name: project.name,
      sourceLocale: project.sourceLocale,
      locales: project.locales,
    },
    catalogs: loaded.states,
    entries,
    summary: summarizeTranslationEntries(entries),
    diagnostics: {
      targetOnlyKeys: countTargetOnlyKeys(
        project.sourceLocale,
        project.locales,
        loaded.contents,
      ),
    },
  };
}

/**
 * Key-centric update: one existing key, only the locales the human actually changed. Each locale
 * carries the revision the workspace was loaded with, so a concurrent human or MCP edit to that
 * locale is rejected rather than overwritten.
 */
export async function updateTranslationKey(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  input: TranslationUpdateInput,
): Promise<TranslationWriteResponse> {
  const project = await getProjectBySlug(cms, projectSlug);
  const key = requireKey(input.key);
  const path = parseTranslationKeyPath(key);
  const changes = normalizeChanges(project, input.changes);

  return applyTranslationChanges(cms, project, key, path, changes);
}

/**
 * Creates a key that does not exist yet. The source-locale value is required (it is what defines
 * the key at all); target values are optional, and a key created without them is simply reported
 * as missing in the workspace.
 */
export async function createTranslationKey(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  input: TranslationCreateInput,
): Promise<TranslationWriteResponse> {
  const project = await getProjectBySlug(cms, projectSlug);
  const key = requireKey(input.key);
  const path = parseTranslationKeyPath(key);
  const values = requireRecord(
    input.values,
    'Translation values are required.',
  );
  const expectedRevisions = readExpectedRevisions(input.expectedRevisions);
  const sourceValue = values[project.sourceLocale];

  if (typeof sourceValue !== 'string' || !sourceValue.trim()) {
    throw new TranslationValidationError(
      `A value for the source locale "${project.sourceLocale}" is required.`,
    );
  }

  const loaded = await loadCatalogs(cms, project);
  assertKeyIsNew(loaded, project, key, path);

  const changes: NormalizedChange[] = [];

  for (const locale of project.locales) {
    const raw = values[locale];

    if (typeof raw !== 'string') {
      continue;
    }

    // A target field left empty is "not translated yet", not an empty translation: creating an
    // empty leaf would report the key as complete and hide it from the Missing filter forever.
    if (locale !== project.sourceLocale && !raw.trim()) {
      continue;
    }

    const expectedRevision = expectedRevisions[locale];

    changes.push({
      locale,
      value: raw,
      ...(expectedRevision ? { expectedRevision } : {}),
    });
  }

  return applyTranslationChanges(cms, project, key, path, changes, loaded);
}

export function isTranslationServiceError(
  error: unknown,
): error is
  | TranslationValidationError
  | TranslationKeyExistsError
  | InvalidTranslationKeyError {
  return (
    error instanceof TranslationValidationError ||
    error instanceof TranslationKeyExistsError ||
    error instanceof InvalidTranslationKeyError
  );
}

/**
 * Preflights every locale (revision matches, key shape compatible) before writing any of them,
 * then writes each through `saveCatalogWithPrecondition` — the same path the machine API, MCP and
 * catalog import already use. There is no transaction across catalog rows and none is faked: if a
 * write still fails after a clean preflight (a genuine race in that narrow window), the result
 * says exactly which locales were saved and which were not, and the UI reports it that way.
 */
async function applyTranslationChanges(
  cms: GlossaCmsRuntime,
  project: Project,
  key: string,
  path: string[],
  changes: NormalizedChange[],
  preloaded?: LoadedCatalogs,
): Promise<TranslationWriteResponse> {
  const before = preloaded ?? (await loadCatalogs(cms, project));
  const preflight = changes.map((change) =>
    preflightChange(before, path, change),
  );

  const results = preflight.some((item) => !item.ok)
    ? notAttempted(preflight)
    : await writeAll(cms, project, preflight);

  const after = await loadCatalogs(cms, project);
  const entry =
    buildTranslationEntries(
      project.sourceLocale,
      project.locales,
      after.contents,
    ).find((candidate) => candidate.key === key) ?? null;

  return {
    key,
    saved: results.every((result) => result.status === 'saved'),
    results,
    entry,
    catalogs: after.states,
  };
}

type PreflightOk = {
  ok: true;
  locale: string;
  content: CatalogContent;
  precondition: CatalogWritePrecondition;
};

type PreflightFailure = {
  ok: false;
  locale: string;
  error: { code: string; message: string };
  currentRevision?: string | null;
};

type PreflightItem = PreflightOk | PreflightFailure;

function preflightChange(
  loaded: LoadedCatalogs,
  path: string[],
  change: NormalizedChange,
): PreflightItem {
  try {
    const existing = loaded.contents.get(change.locale);
    const currentRevision = loaded.states[change.locale]?.revision;

    if (existing && currentRevision) {
      if (change.expectedRevision !== currentRevision) {
        throw new CatalogRevisionConflictError(currentRevision);
      }
    } else if (change.expectedRevision) {
      // The workspace believed this locale had a catalog; it no longer does.
      throw new CatalogRevisionConflictError(null);
    }

    return {
      ok: true,
      locale: change.locale,
      content: setTranslationValue(existing ?? {}, path, change.value),
      precondition: currentRevision
        ? { ifMatch: currentRevision }
        : { ifNoneMatchAny: true },
    };
  } catch (error) {
    return toPreflightFailure(change.locale, error);
  }
}

async function writeAll(
  cms: GlossaCmsRuntime,
  project: Project,
  preflight: PreflightItem[],
): Promise<TranslationWriteResult[]> {
  const results: TranslationWriteResult[] = [];

  for (const item of preflight) {
    if (!item.ok) {
      continue;
    }

    try {
      const catalog = await saveCatalogWithPrecondition(
        cms,
        project.slug,
        item.locale,
        item.content,
        item.precondition,
      );
      results.push({
        locale: item.locale,
        status: 'saved',
        revision: catalog.revision,
      });
    } catch (error) {
      results.push(toFailedResult(toPreflightFailure(item.locale, error)));
    }
  }

  return results;
}

function notAttempted(preflight: PreflightItem[]): TranslationWriteResult[] {
  return preflight.map((item) =>
    item.ok
      ? {
          locale: item.locale,
          status: 'failed' as const,
          error: {
            code: 'TRANSLATION_WRITE_NOT_ATTEMPTED',
            message:
              'Not saved: another locale in this change could not be saved.',
          },
        }
      : toFailedResult(item),
  );
}

function toFailedResult(failure: PreflightFailure): TranslationWriteResult {
  return {
    locale: failure.locale,
    status: 'failed',
    error: failure.error,
    ...(failure.currentRevision === undefined
      ? {}
      : { currentRevision: failure.currentRevision }),
  };
}

function toPreflightFailure(locale: string, error: unknown): PreflightFailure {
  if (error instanceof CatalogRevisionConflictError) {
    return {
      ok: false,
      locale,
      error: { code: error.code, message: error.message },
      currentRevision: error.currentRevision,
    };
  }

  if (
    error instanceof InvalidTranslationKeyError ||
    isCatalogServiceError(error)
  ) {
    return {
      ok: false,
      locale,
      error: { code: error.code, message: error.message },
    };
  }

  throw error;
}

function assertKeyIsNew(
  loaded: LoadedCatalogs,
  project: Project,
  key: string,
  path: string[],
): void {
  const source = loaded.contents.get(project.sourceLocale);

  if (source && getTranslationValue(source, path) !== undefined) {
    throw new TranslationKeyExistsError(key);
  }
}

/**
 * One `listCatalogs` read for the whole project — never one request per key or per locale.
 * Exported so the translation-lifecycle service reuses the exact same load, rather than a second
 * one that could drift (e.g. forget a locale with no catalog yet).
 */
export async function loadCatalogs(
  cms: GlossaCmsRuntime,
  project: Project,
): Promise<LoadedCatalogs> {
  const records = await listCatalogs(cms, project.slug);
  const contents = new Map<string, CatalogContent>();
  const states: Record<string, TranslationCatalogState> = {};

  for (const locale of project.locales) {
    const record = records.find((candidate) => candidate.locale === locale);

    if (record) {
      contents.set(locale, record.content);
      states[locale] = { exists: true, revision: record.revision };
    } else {
      states[locale] = { exists: false };
    }
  }

  return { contents, states };
}

export function requireKey(value: unknown, label = 'Translation key'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TranslationValidationError(`${label} is required.`);
  }

  return value.trim();
}

function normalizeChanges(
  project: Project,
  value: unknown,
): NormalizedChange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TranslationValidationError(
      'At least one locale change is required.',
    );
  }

  const seen = new Set<string>();

  return value.map((raw: TranslationChangeInput) => {
    if (typeof raw?.locale !== 'string' || !raw.locale.trim()) {
      throw new TranslationValidationError('Each change requires a locale.');
    }

    const locale = raw.locale.trim();

    if (!project.locales.includes(locale)) {
      throw new TranslationValidationError(
        `Locale "${locale}" is not configured for this project.`,
      );
    }

    if (seen.has(locale)) {
      throw new TranslationValidationError(
        `Locale "${locale}" appears more than once in this change.`,
      );
    }

    seen.add(locale);

    if (typeof raw.value !== 'string') {
      throw new TranslationValidationError(
        `The value for locale "${locale}" must be a string.`,
      );
    }

    if (
      raw.expectedRevision !== undefined &&
      typeof raw.expectedRevision !== 'string'
    ) {
      throw new TranslationValidationError(
        `The expected revision for locale "${locale}" must be a string.`,
      );
    }

    return {
      locale,
      value: raw.value,
      ...(raw.expectedRevision
        ? { expectedRevision: raw.expectedRevision }
        : {}),
    };
  });
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TranslationValidationError(message);
  }

  return value as Record<string, unknown>;
}

export function readExpectedRevisions(value: unknown): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }

  const raw = requireRecord(value, 'Expected revisions must be an object.');
  const revisions: Record<string, string> = {};

  for (const [locale, revision] of Object.entries(raw)) {
    if (typeof revision === 'string' && revision) {
      revisions[locale] = revision;
    }
  }

  return revisions;
}
