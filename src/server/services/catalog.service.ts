import { UniqueConstraintError } from '@forge-cms/runtime';
import type { CollectionDocument } from '@forge-cms/core';

import { randomBase64Url } from '../auth/encoding';
import type { GlossaCmsRuntime } from '../cms/runtime';
import { catalogsCollection } from '../cms/collections/catalogs';
import {
  CatalogValidationError,
  DEFAULT_CATALOG_NAMESPACE,
  toCatalogRecord,
  validateCatalogContent,
  type CatalogRecord,
} from '../domain/catalog';
import { getProjectBySlug } from './project.service';

const CATALOGS_COLLECTION = 'catalogs';
type CatalogDocument = CollectionDocument<typeof catalogsCollection>;

export class CatalogNotFoundError extends Error {
  readonly code = 'CATALOG_NOT_FOUND';

  constructor() {
    super('Catalog not found');
  }
}

export class CatalogLocaleNotConfiguredError extends Error {
  readonly code = 'CATALOG_LOCALE_NOT_CONFIGURED';

  constructor(locale: string) {
    super(`Locale "${locale}" is not configured for this project.`);
  }
}

export class CatalogIdentityConflictError extends Error {
  readonly code = 'CATALOG_IDENTITY_CONFLICT';

  constructor() {
    super('Catalog already exists for this project, locale, and namespace.');
  }
}

/**
 * Thrown when a write's optimistic-concurrency precondition (HTTP `If-Match`/`If-None-Match`
 * semantics — see `saveCatalogWithPrecondition`) does not hold: the caller's expected revision
 * no longer matches what is stored, or is missing entirely for an existing catalog. Carries the
 * *current* revision (`null` when the catalog does not exist) so a caller can re-read and retry.
 */
export class CatalogRevisionConflictError extends Error {
  readonly code = 'CATALOG_REVISION_CONFLICT';
  readonly currentRevision: string | null;

  constructor(currentRevision: string | null) {
    super('Catalog changed since it was read.');
    this.currentRevision = currentRevision;
  }
}

/**
 * HTTP-style write precondition for `saveCatalogWithPrecondition`. Mirrors `If-Match` (a specific
 * expected revision) and `If-None-Match: *` (only recognized as the literal wildcard — "create
 * only if absent") rather than inventing a body-level revision field.
 */
export type CatalogWritePrecondition = {
  ifMatch?: string;
  ifNoneMatchAny?: boolean;
};

export async function listCatalogs(
  cms: GlossaCmsRuntime,
  projectSlug: string,
): Promise<CatalogRecord[]> {
  const project = await getProjectBySlug(cms, projectSlug);

  const page = await cms.find({
    collection: CATALOGS_COLLECTION,
    where: {
      project: project.id,
      namespace: DEFAULT_CATALOG_NAMESPACE,
    },
    sort: 'locale',
    order: 'asc',
  });

  return page.docs.map(toCatalogRecord);
}

export async function getCatalog(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  locale: string,
): Promise<CatalogRecord> {
  const project = await getProjectBySlug(cms, projectSlug);
  assertLocaleConfigured(project.locales, locale);

  const record = await findCatalog(cms, project.id, locale);

  if (!record) {
    throw new CatalogNotFoundError();
  }

  return toCatalogRecord(record);
}

export async function saveCatalog(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  locale: string,
  content: unknown,
): Promise<CatalogRecord> {
  const project = await getProjectBySlug(cms, projectSlug);
  assertLocaleConfigured(project.locales, locale);

  const existing = await findCatalog(cms, project.id, locale);
  const record = await writeCatalog(cms, project.id, locale, content, existing);

  return toCatalogRecord(record);
}

/**
 * Same write path as `saveCatalog`, with an HTTP-style optimistic-concurrency precondition
 * enforced first. A blind write to an *existing* catalog is refused — the caller must supply the
 * revision it last read (`ifMatch`) or explicitly assert absence (`ifNoneMatchAny`) — so a human
 * edit and a machine edit racing on the same locale can never silently clobber one another. Used
 * by the machine catalog API; human saves through the UI still go through `saveCatalog` above and
 * are intentionally not preconditioned (out of scope for this milestone).
 */
export async function saveCatalogWithPrecondition(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  locale: string,
  content: unknown,
  precondition: CatalogWritePrecondition,
): Promise<CatalogRecord> {
  const project = await getProjectBySlug(cms, projectSlug);
  assertLocaleConfigured(project.locales, locale);

  const existing = await findCatalog(cms, project.id, locale);

  if (existing) {
    const currentRevision = readRevision(existing);

    if (
      precondition.ifNoneMatchAny ||
      !precondition.ifMatch ||
      precondition.ifMatch !== currentRevision
    ) {
      throw new CatalogRevisionConflictError(currentRevision);
    }
  } else if (precondition.ifMatch) {
    throw new CatalogRevisionConflictError(null);
  }

  const record = await writeCatalog(cms, project.id, locale, content, existing);

  return toCatalogRecord(record);
}

export async function deleteCatalog(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  locale: string,
): Promise<CatalogRecord> {
  const project = await getProjectBySlug(cms, projectSlug);
  assertLocaleConfigured(project.locales, locale);

  const existing = await findCatalog(cms, project.id, locale);

  if (!existing) {
    throw new CatalogNotFoundError();
  }

  const record = await cms.delete({
    collection: CATALOGS_COLLECTION,
    id: existing.id,
  });

  return toCatalogRecord(record);
}

export function isCatalogServiceError(
  error: unknown,
): error is
  | CatalogNotFoundError
  | CatalogLocaleNotConfiguredError
  | CatalogIdentityConflictError
  | CatalogRevisionConflictError
  | CatalogValidationError {
  return (
    error instanceof CatalogNotFoundError ||
    error instanceof CatalogLocaleNotConfiguredError ||
    error instanceof CatalogIdentityConflictError ||
    error instanceof CatalogRevisionConflictError ||
    error instanceof CatalogValidationError
  );
}

function assertLocaleConfigured(locales: string[], locale: string): void {
  if (!locales.includes(locale)) {
    throw new CatalogLocaleNotConfiguredError(locale);
  }
}

async function findCatalog(
  cms: GlossaCmsRuntime,
  projectId: string,
  locale: string,
): Promise<CatalogDocument | null> {
  return cms.findOne({
    collection: CATALOGS_COLLECTION,
    where: {
      project: projectId,
      locale,
      namespace: DEFAULT_CATALOG_NAMESPACE,
    },
  });
}

type CatalogWriteData = {
  project: string;
  locale: string;
  namespace: string;
  content: ReturnType<typeof validateCatalogContent>;
  revision: string;
  updatedAt: string;
};

/** Centralizes revision generation so every write path — human UI or machine API — advances it. */
async function writeCatalog(
  cms: GlossaCmsRuntime,
  projectId: string,
  locale: string,
  content: unknown,
  existing: CatalogDocument | null,
): Promise<CatalogDocument> {
  const data: CatalogWriteData = {
    project: projectId,
    locale,
    namespace: DEFAULT_CATALOG_NAMESPACE,
    content: validateCatalogContent(content),
    revision: generateRevision(),
    updatedAt: new Date().toISOString(),
  };

  return existing
    ? cms.update({ collection: CATALOGS_COLLECTION, id: existing.id, data })
    : createOrUpdateCatalog(cms, projectId, locale, data);
}

function generateRevision(): string {
  return randomBase64Url(16);
}

function readRevision(record: CatalogDocument): string | null {
  return typeof record.revision === 'string' ? record.revision : null;
}

async function createOrUpdateCatalog(
  cms: GlossaCmsRuntime,
  projectId: string,
  locale: string,
  data: CatalogWriteData,
) {
  try {
    return await cms.create({
      collection: CATALOGS_COLLECTION,
      data,
    });
  } catch (error) {
    if (
      error instanceof UniqueConstraintError &&
      error.collection === CATALOGS_COLLECTION
    ) {
      const existing = await findCatalog(cms, projectId, locale);

      if (!existing) {
        throw new CatalogIdentityConflictError();
      }

      return cms.update({
        collection: CATALOGS_COLLECTION,
        id: existing.id,
        data,
      });
    }

    throw error;
  }
}
