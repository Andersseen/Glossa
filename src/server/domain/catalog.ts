import {
  validateCatalogRecord,
  type CatalogRecord,
} from '../cms/collections/catalogs';

export function defineCatalog(catalog: CatalogRecord): CatalogRecord {
  return validateCatalogRecord(catalog);
}
