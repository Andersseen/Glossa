export type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
  publicDelivery: boolean;
};

export type ProjectInput = {
  name?: unknown;
  slug?: unknown;
  sourceLocale?: unknown;
  locales?: unknown;
  publicDelivery?: unknown;
};

export type ProjectRecord = {
  id: unknown;
  name: unknown;
  slug: unknown;
  sourceLocale: unknown;
  locales: unknown;
  publicDelivery?: unknown;
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
    publicDelivery: toBooleanFlag(input.publicDelivery, false),
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
    publicDelivery: input.publicDelivery ?? current.publicDelivery,
  });
}

export function toProject(record: ProjectRecord): Project {
  return {
    id: requireString(record.id, 'Project id is required.'),
    name: requireString(record.name, 'Project name is required.'),
    slug: requireString(record.slug, 'Project slug is required.'),
    sourceLocale: requireString(
      record.sourceLocale,
      'Source locale is required.',
    ),
    locales: normalizeLocales(record.locales),
    // Existing D1 rows predate this field and have no stored value — treated as
    // "not enabled" rather than a validation failure (see the field's schema
    // definition, which is deliberately not `required` for the same reason).
    publicDelivery: toBooleanFlag(record.publicDelivery, false),
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

/** Lenient boolean coercion for a flag that may be absent (pre-existing rows) or stored as `0`/`1`. */
function toBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 0 || value === 1) {
    return value === 1;
  }

  return fallback;
}
