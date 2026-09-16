/**
 * The wire shape of `/api/projects/:slug/translations`. Mirrors the server's translation-domain
 * types deliberately rather than importing them — `src/app` never imports from `src/server`.
 */
export type TranslationEntryValue = {
  exists: boolean;
  value?: string;
};

export type TranslationEntry = {
  key: string;
  sourceValue: string;
  values: Record<string, TranslationEntryValue>;
  translatedCount: number;
  totalLocales: number;
  complete: boolean;
};

export type TranslationCatalogState = {
  exists: boolean;
  revision?: string;
};

export type TranslationWorkspaceProject = {
  slug: string;
  name: string;
  sourceLocale: string;
  locales: string[];
};

export type TranslationWorkspace = {
  project: TranslationWorkspaceProject;
  catalogs: Record<string, TranslationCatalogState>;
  entries: TranslationEntry[];
  summary: {
    totalKeys: number;
    completeKeys: number;
    missingKeys: number;
  };
  diagnostics: {
    targetOnlyKeys: Record<string, number>;
  };
};

export type TranslationWorkspaceResponse = {
  workspace: TranslationWorkspace;
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
  entry: TranslationEntry | null;
  catalogs: Record<string, TranslationCatalogState>;
};

/** One locale's pending edit, as submitted by the key editor. */
export type TranslationFieldChange = {
  locale: string;
  value: string;
};

export type TranslationFilter = 'all' | 'missing' | 'complete';
