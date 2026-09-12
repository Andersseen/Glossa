import {
  CatalogValidationError,
  countCatalogMessages,
  validateCatalogContent,
  type CatalogContent,
} from '../domain/catalog';
import type { Project } from '../domain/project';
import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
  CatalogRevisionConflictError,
  getCatalog,
  saveCatalogWithPrecondition,
  type CatalogWritePrecondition,
} from './catalog.service';
import { getProjectBySlug } from './project.service';

/** Generous but bounded — three real ~1,000-key catalogs is the normal case; this guards against abuse, not normal onboarding. */
const MAX_IMPORT_CATALOGS = 50;

export class CatalogImportValidationError extends Error {
  readonly code = 'CATALOG_IMPORT_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when an import item targets a locale that already has a stored catalog and the caller
 * did not explicitly opt into replacing it. Distinct from `CatalogRevisionConflictError` (a stale
 * precondition) — this is "you didn't say you wanted to replace this at all".
 */
export class CatalogImportReplaceRequiredError extends Error {
  readonly code = 'CATALOG_IMPORT_REPLACE_REQUIRED';
  readonly currentRevision: string;

  constructor(locale: string, currentRevision: string) {
    super(
      `Catalog "${locale}" already exists. Replacing it requires explicit confirmation.`,
    );
    this.currentRevision = currentRevision;
  }
}

export type CatalogImportItemInput = {
  locale?: unknown;
  content?: unknown;
  replaceExisting?: unknown;
  expectedRevision?: unknown;
};

export type CatalogImportItemResult =
  | {
      locale: string;
      ok: true;
      status: 'new' | 'existing';
      messageCount: number;
      existingMessageCount?: number;
      existingRevision?: string;
    }
  | {
      locale: string;
      ok: false;
      error: { code: string; message: string };
    };

export type CatalogImportPreviewResult = {
  results: CatalogImportItemResult[];
  canImport: boolean;
};

export type CatalogImportCommitItemResult =
  | {
      locale: string;
      status: 'imported';
      revision: string;
      messageCount: number;
    }
  | {
      locale: string;
      status: 'failed';
      error: { code: string; message: string };
    };

export type CatalogImportCommitResult = {
  results: CatalogImportCommitItemResult[];
  imported: boolean;
};

/**
 * Validates the whole batch and reports, per item, whether it would create a new catalog or
 * replace an existing one — without writing anything. Server-side validation is authoritative
 * here exactly as it is for a normal catalog save; a client-side JSON/locale check is only a
 * convenience, never trusted on its own.
 */
export async function previewCatalogImport(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  body: unknown,
): Promise<CatalogImportPreviewResult> {
  const project = await getProjectBySlug(cms, projectSlug);
  const labeled = labelImportBatch(normalizeImportBatch(body));

  const results = await Promise.all(
    labeled.map(({ item, label, isDuplicate }) =>
      evaluatePreviewItem(cms, project, item, label, isDuplicate),
    ),
  );

  return { results, canImport: results.every((result) => result.ok) };
}

/**
 * Preflights the entire batch first — no writes happen unless every item passes — then saves each
 * catalog through the same `saveCatalogWithPrecondition` path a human/machine edit already uses,
 * so revisions, `updatedAt`, and optimistic-concurrency all behave identically to any other write.
 * If a write still fails after preflight passed (a genuine race in the narrow window between the
 * two), the result reports exactly what succeeded and what failed — there is no transaction to
 * roll back.
 */
export async function commitCatalogImport(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  body: unknown,
): Promise<CatalogImportCommitResult> {
  const project = await getProjectBySlug(cms, projectSlug);
  const labeled = labelImportBatch(normalizeImportBatch(body));

  const preflight = await Promise.all(
    labeled.map(({ item, label, isDuplicate }) =>
      evaluateCommitItem(cms, project, item, label, isDuplicate),
    ),
  );

  const failures = preflight.filter(
    (item): item is CommitPreflightError => !item.ok,
  );

  if (failures.length > 0) {
    return {
      imported: false,
      results: preflight.map((item) =>
        item.ok
          ? {
              locale: item.locale,
              status: 'failed',
              error: {
                code: 'CATALOG_IMPORT_NOT_ATTEMPTED',
                message:
                  'Not imported: another catalog in this batch failed validation.',
              },
            }
          : { locale: item.locale, status: 'failed', error: item.error },
      ),
    };
  }

  const okItems = preflight.filter(
    (item): item is CommitPreflightOk => item.ok,
  );
  const results: CatalogImportCommitItemResult[] = [];

  for (const item of okItems) {
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
        status: 'imported',
        revision: catalog.revision,
        messageCount: countCatalogMessages(catalog.content),
      });
    } catch (error) {
      if (isCatalogImportItemError(error)) {
        results.push({
          locale: item.locale,
          status: 'failed',
          error: { code: error.code, message: error.message },
        });
      } else {
        throw error;
      }
    }
  }

  return {
    imported: results.every((result) => result.status === 'imported'),
    results,
  };
}

type CommitPreflightOk = {
  ok: true;
  locale: string;
  content: CatalogContent;
  precondition: CatalogWritePrecondition;
};

type CommitPreflightError = {
  ok: false;
  locale: string;
  error: { code: string; message: string };
};

type CommitPreflightItem = CommitPreflightOk | CommitPreflightError;

async function evaluatePreviewItem(
  cms: GlossaCmsRuntime,
  project: Project,
  raw: CatalogImportItemInput,
  label: string,
  isDuplicate: boolean,
): Promise<CatalogImportItemResult> {
  try {
    const locale = requireItemLocale(project, raw, label, isDuplicate);
    const content = validateCatalogContent(raw.content);
    const messageCount = countCatalogMessages(content);
    const existing = await findExistingCatalog(cms, project, locale);

    if (!existing) {
      return { locale, ok: true, status: 'new', messageCount };
    }

    return {
      locale,
      ok: true,
      status: 'existing',
      messageCount,
      existingMessageCount: countCatalogMessages(existing.content),
      existingRevision: existing.revision,
    };
  } catch (error) {
    if (isCatalogImportItemError(error)) {
      return {
        locale: label,
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }

    throw error;
  }
}

async function evaluateCommitItem(
  cms: GlossaCmsRuntime,
  project: Project,
  raw: CatalogImportItemInput,
  label: string,
  isDuplicate: boolean,
): Promise<CommitPreflightItem> {
  try {
    const locale = requireItemLocale(project, raw, label, isDuplicate);
    const content = validateCatalogContent(raw.content);
    const existing = await findExistingCatalog(cms, project, locale);

    if (!existing) {
      return {
        ok: true,
        locale,
        content,
        precondition: { ifNoneMatchAny: true },
      };
    }

    if (raw.replaceExisting !== true) {
      throw new CatalogImportReplaceRequiredError(locale, existing.revision);
    }

    if (
      typeof raw.expectedRevision !== 'string' ||
      raw.expectedRevision !== existing.revision
    ) {
      throw new CatalogRevisionConflictError(existing.revision);
    }

    return {
      ok: true,
      locale,
      content,
      precondition: { ifMatch: existing.revision },
    };
  } catch (error) {
    if (isCatalogImportItemError(error)) {
      return {
        ok: false,
        locale: label,
        error: { code: error.code, message: error.message },
      };
    }

    throw error;
  }
}

function requireItemLocale(
  project: Project,
  raw: CatalogImportItemInput,
  label: string,
  isDuplicate: boolean,
): string {
  if (isDuplicate) {
    throw new CatalogImportValidationError(
      `Locale "${label}" is mapped by more than one file in this import.`,
    );
  }

  if (typeof raw.locale !== 'string' || !raw.locale.trim()) {
    throw new CatalogImportValidationError('Locale is required.');
  }

  const locale = raw.locale.trim();

  if (!project.locales.includes(locale)) {
    throw new CatalogLocaleNotConfiguredError(locale);
  }

  return locale;
}

async function findExistingCatalog(
  cms: GlossaCmsRuntime,
  project: Project,
  locale: string,
) {
  try {
    return await getCatalog(cms, project.slug, locale);
  } catch (error) {
    if (error instanceof CatalogNotFoundError) {
      return null;
    }

    throw error;
  }
}

type LabeledImportItem = {
  item: CatalogImportItemInput;
  label: string;
  isDuplicate: boolean;
};

/** Pairs each raw item with a display label and duplicate flag in one pass — avoids re-indexing a parallel labels array (unsafe under `noUncheckedIndexedAccess`) at each call site. */
function labelImportBatch(
  items: CatalogImportItemInput[],
): LabeledImportItem[] {
  const labels = items.map((item, index) =>
    typeof item.locale === 'string' && item.locale.trim()
      ? item.locale.trim()
      : `#${index + 1}`,
  );

  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const label of labels) {
    if (seen.has(label)) {
      duplicates.add(label);
    }

    seen.add(label);
  }

  return items.map((item, index) => ({
    item,
    label: labels[index] ?? `#${index + 1}`,
    isDuplicate: duplicates.has(labels[index] ?? ''),
  }));
}

function normalizeImportBatch(body: unknown): CatalogImportItemInput[] {
  const catalogs =
    body && typeof body === 'object'
      ? (body as { catalogs?: unknown }).catalogs
      : undefined;

  if (!Array.isArray(catalogs)) {
    throw new CatalogImportValidationError('A "catalogs" array is required.');
  }

  if (catalogs.length === 0) {
    throw new CatalogImportValidationError('At least one catalog is required.');
  }

  if (catalogs.length > MAX_IMPORT_CATALOGS) {
    throw new CatalogImportValidationError(
      `No more than ${MAX_IMPORT_CATALOGS} catalogs can be imported in a single batch.`,
    );
  }

  return catalogs as CatalogImportItemInput[];
}

export function isCatalogImportItemError(
  error: unknown,
): error is
  | CatalogImportValidationError
  | CatalogImportReplaceRequiredError
  | CatalogLocaleNotConfiguredError
  | CatalogValidationError
  | CatalogRevisionConflictError {
  return (
    error instanceof CatalogImportValidationError ||
    error instanceof CatalogImportReplaceRequiredError ||
    error instanceof CatalogLocaleNotConfiguredError ||
    error instanceof CatalogValidationError ||
    error instanceof CatalogRevisionConflictError
  );
}

export function isCatalogImportBatchError(
  error: unknown,
): error is CatalogImportValidationError {
  return error instanceof CatalogImportValidationError;
}
