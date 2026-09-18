export type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
  publicDelivery: boolean;
};

/** Mirrors `SourceLocalePreview` from `GET /api/projects/:slug/source-locale-preview`. */
export type SourceLocalePreview = {
  currentSourceLocale: string;
  nextSourceLocale: string;
  changed: boolean;
  hasCatalogs: boolean;
  currentSourceCatalogExists: boolean;
  nextSourceCatalogExists: boolean;
  canChange: boolean;
  currentSourceKeys: number;
  nextSourceKeys: number;
  addedCanonicalKeys: string[];
  removedCanonicalKeys: string[];
};

/** Mirrors `ProjectDeletionImpact` from `GET /api/projects/:slug/deletion-impact`. */
export type ProjectDeletionImpact = {
  project: { id: string; slug: string; name: string };
  locales: string[];
  catalogLocales: string[];
  catalogs: number;
  accessTokens: { total: number; active: number };
  publicDelivery: boolean;
};
