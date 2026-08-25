export type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
};

export type ProjectInput = {
  name?: unknown;
  slug?: unknown;
  sourceLocale?: unknown;
  locales?: unknown;
};

export class ProjectValidationError extends Error {
  readonly code = 'PROJECT_VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|\d{3})?$/;

export function validateProjectInput(input: ProjectInput): Omit<Project, 'id'> {
  const name = requireString(input.name, 'Project name is required.');
  const slug = requireString(input.slug, 'Project slug is required.');
  const sourceLocale = requireString(
    input.sourceLocale,
    'Source locale is required.',
  );
  const locales = normalizeLocales(input.locales);

  if (!SLUG_PATTERN.test(slug)) {
    throw new ProjectValidationError(
      'Project slug must be lowercase kebab-case.',
    );
  }

  validateLocale(sourceLocale, 'Source locale is invalid.');

  if (locales.length === 0) {
    throw new ProjectValidationError('At least one locale is required.');
  }

  for (const locale of locales) {
    validateLocale(locale, `Locale "${locale}" is invalid.`);
  }

  if (new Set(locales).size !== locales.length) {
    throw new ProjectValidationError('Locales must be unique.');
  }

  if (!locales.includes(sourceLocale)) {
    throw new ProjectValidationError('Locales must include the source locale.');
  }

  return {
    name,
    slug,
    sourceLocale,
    locales,
  };
}

export function mergeProjectInput(
  current: Project,
  input: ProjectInput,
): Omit<Project, 'id'> {
  return validateProjectInput({
    name: input.name ?? current.name,
    slug: input.slug ?? current.slug,
    sourceLocale: input.sourceLocale ?? current.sourceLocale,
    locales: input.locales ?? current.locales,
  });
}

export function toProject(record: Record<string, unknown>): Project {
  return {
    id: requireString(record['id'], 'Project id is required.'),
    name: requireString(record['name'], 'Project name is required.'),
    slug: requireString(record['slug'], 'Project slug is required.'),
    sourceLocale: requireString(
      record['sourceLocale'],
      'Source locale is required.',
    ),
    locales: normalizeLocales(record['locales']),
  };
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProjectValidationError(message);
  }

  return value.trim();
}

function normalizeLocales(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ProjectValidationError('Locales must be a list.');
  }

  return value.map((locale) => requireString(locale, 'Locale is required.'));
}

function validateLocale(locale: string, message: string): void {
  if (!LOCALE_PATTERN.test(locale)) {
    throw new ProjectValidationError(message);
  }
}
