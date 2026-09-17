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

export type TranslationLifecycleWriteResult =
  | { locale: string; status: 'saved'; revision: string }
  | {
      locale: string;
      status: 'failed';
      error: { code: string; message: string };
    };

/** The wire shape of `/api/projects/:slug/translations/rename` and `.../delete`. */
export type TranslationLifecycleResponse = {
  operation: 'rename' | 'delete';
  key: string;
  newKey?: string;
  saved: boolean;
  results: TranslationLifecycleWriteResult[];
  catalogs: Record<string, TranslationCatalogState>;
};

/**
 * The wire shape of `/api/projects/:slug/translations/analysis` — the same structural key-set
 * diff `analyze_translations` returns over MCP. `coverage` is `null` only when the source locale
 * has no catalog/keys yet; everywhere else it mirrors `translatedKeys / totalSourceKeys`.
 */
export type TranslationLocaleAnalysis = {
  locale: string;
  isSource: boolean;
  catalogExists: boolean;
  totalSourceKeys: number;
  translatedKeys: number;
  missingKeys: string[];
  extraKeys: string[];
  coverage: number | null;
};

export type TranslationAnalysis = {
  sourceLocale: string;
  sourceKeys: number;
  completeKeys: number;
  incompleteKeys: number;
  locales: TranslationLocaleAnalysis[];
};

export type TranslationAnalysisResponse = {
  project: TranslationWorkspaceProject;
  analysis: TranslationAnalysis;
};
