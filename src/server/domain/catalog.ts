export interface CatalogContent {
  [key: string]: string | CatalogContent;
}

export type CatalogRecord = {
  project: string;
  locale: string;
  namespace?: string;
  content: CatalogContent;
};

export function defineCatalog(catalog: CatalogRecord): CatalogRecord {
  if (!catalog.project.trim()) {
    throw new Error('Catalog project is required.');
  }

  if (!catalog.locale.trim()) {
    throw new Error('Catalog locale is required.');
  }

  if (Object.keys(catalog.content).length === 0) {
    throw new Error('Catalog content cannot be empty.');
  }

  return catalog;
}
