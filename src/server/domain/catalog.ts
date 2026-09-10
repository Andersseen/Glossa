export interface CatalogContent {
  [key: string]: string | CatalogContent;
}

export type CatalogRecord = {
  project: string;
  locale: string;
  namespace: string;
  content: CatalogContent;
  revision: string;
  updatedAt: string;
};

export type StoredCatalogRecord = {
  project: unknown;
  locale: unknown;
  namespace?: unknown;
  content: unknown;
  revision?: unknown;
  updatedAt?: unknown;
};

export class CatalogValidationError extends Error {
  readonly code = 'CATALOG_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Catalogs are namespaced from the start (`(project, locale, namespace)` is the
 * uniqueness key in ForgeCMS), but this branch only ever reads and writes the
 * default namespace. Namespace selection UI comes later.
 */
export const DEFAULT_CATALOG_NAMESPACE = '';

export function validateCatalogContent(value: unknown): CatalogContent {
  return validateCatalogNode(value, '');
}

export function toCatalogRecord(record: StoredCatalogRecord): CatalogRecord {
  return {
    project: requireString(record.project, 'Catalog project is required.'),
    locale: requireString(record.locale, 'Catalog locale is required.'),
    namespace:
      typeof record.namespace === 'string'
        ? record.namespace
        : DEFAULT_CATALOG_NAMESPACE,
    content: validateCatalogContent(record.content),
    revision: requireString(record.revision, 'Catalog revision is required.'),
    updatedAt: requireString(
      record.updatedAt,
      'Catalog updatedAt is required.',
    ),
  };
}

function validateCatalogNode(value: unknown, path: string): CatalogContent {
  if (!isPlainObject(value)) {
    throw new CatalogValidationError(
      path
        ? `Translation value at "${path}" must be a string or object.`
        : 'Catalog root must be an object.',
    );
  }

  const content: CatalogContent = {};

  for (const [key, raw] of Object.entries(value)) {
    const nodePath = path ? `${path}.${key}` : key;

    if (typeof raw === 'string') {
      content[key] = raw;
    } else if (isPlainObject(raw)) {
      content[key] = validateCatalogNode(raw, nodePath);
    } else {
      throw new CatalogValidationError(
        `Translation value at "${nodePath}" must be a string or object.`,
      );
    }
  }

  return content;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CatalogValidationError(message);
  }

  return value.trim();
}
