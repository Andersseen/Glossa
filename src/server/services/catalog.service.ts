import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  CatalogValidationError,
  DEFAULT_CATALOG_NAMESPACE,
  toCatalogRecord,
  validateCatalogContent,
  type CatalogRecord,
} from '../domain/catalog';
import { getProjectBySlug } from './project.service';

const CATALOGS_COLLECTION = 'catalogs';

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
        id: requireId(existing),
        data,
      })
    : await cms.create({
        collection: CATALOGS_COLLECTION,
        data,
      });

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
    id: requireId(existing),
  });

  return toCatalogRecord(record);
}

export function isCatalogServiceError(
  error: unknown,
): error is
  | CatalogNotFoundError
  | CatalogLocaleNotConfiguredError
  | CatalogValidationError {
  return (
    error instanceof CatalogNotFoundError ||
    error instanceof CatalogLocaleNotConfiguredError ||
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
): Promise<Record<string, unknown> | null> {
  const page = await cms.find({
    collection: CATALOGS_COLLECTION,
    where: {
      project: projectId,
      locale,
      namespace: DEFAULT_CATALOG_NAMESPACE,
    },
    limit: 1,
  });

  const [record] = page.docs;
  return record ?? null;
}

function requireId(record: Record<string, unknown>): string {
  const id = record['id'];

  if (typeof id !== 'string' || !id) {
    throw new CatalogValidationError('Catalog id is required.');
  }

  return id;
}
