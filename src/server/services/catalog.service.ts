import { UniqueConstraintError } from '@forge-cms/runtime';
import type { CollectionDocument } from '@forge-cms/core';

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
  const validatedContent = validateCatalogContent(content);

  const existing = await findCatalog(cms, project.id, locale);
  const data = {
    project: project.id,
    locale,
    namespace: DEFAULT_CATALOG_NAMESPACE,
    content: validatedContent,
  };

  const record = existing
    ? await cms.update({
        collection: CATALOGS_COLLECTION,
        id: existing.id,
        data,
      })
    : await createOrUpdateCatalog(cms, project.id, locale, data);

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
  | CatalogValidationError {
  return (
    error instanceof CatalogNotFoundError ||
    error instanceof CatalogLocaleNotConfiguredError ||
    error instanceof CatalogIdentityConflictError ||
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

async function createOrUpdateCatalog(
  cms: GlossaCmsRuntime,
  projectId: string,
  locale: string,
  data: {
    project: string;
    locale: string;
    namespace: string;
    content: ReturnType<typeof validateCatalogContent>;
  },
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
