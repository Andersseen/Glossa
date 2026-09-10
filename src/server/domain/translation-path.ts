import type { CatalogContent } from './catalog';

export class InvalidTranslationKeyError extends Error {
  readonly code = 'INVALID_TRANSLATION_KEY';

  constructor(message: string) {
    super(message);
  }
}

const DANGEROUS_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Splits an MCP-facing dot-path key (`nav.home`) into segments, rejecting anything that could
 * reach off the intended object graph — an empty segment, or one of `__proto__`/`prototype`/
 * `constructor`, which would otherwise let a crafted key walk onto `Object.prototype` during the
 * plain-object traversal `getTranslationValue`/`setTranslationValue` perform below.
 */
export function parseTranslationKeyPath(key: string): string[] {
  if (typeof key !== 'string' || !key.trim()) {
    throw new InvalidTranslationKeyError('Translation key is required.');
  }

  const segments = key.split('.');

  for (const segment of segments) {
    if (!segment) {
      throw new InvalidTranslationKeyError(
        `Translation key "${key}" has an empty segment.`,
      );
    }

    if (DANGEROUS_SEGMENTS.has(segment)) {
      throw new InvalidTranslationKeyError(
        `Translation key "${key}" contains a disallowed segment "${segment}".`,
      );
    }
  }

  return segments;
}

export function getTranslationValue(
  content: CatalogContent,
  path: string[],
): string | undefined {
  let node: string | CatalogContent | undefined = content;

  for (const segment of path) {
    if (typeof node !== 'object' || node === null) {
      return undefined;
    }

    node = node[segment];
  }

  return typeof node === 'string' ? node : undefined;
}

/**
 * Returns a new catalog content object with `value` written at `path`, creating any missing
 * intermediate objects along the way. Only the branches on `path` are cloned — sibling subtrees
 * are referentially reused — so this stays cheap even for a large catalog and a single-key edit.
 * `path` must be non-empty (guaranteed by `parseTranslationKeyPath`).
 */
export function setTranslationValue(
  content: CatalogContent,
  path: string[],
  value: string,
): CatalogContent {
  const head = path[0];

  if (head === undefined) {
    throw new InvalidTranslationKeyError('Translation key path is empty.');
  }

  const rest = path.slice(1);
  const existing = content[head];

  if (rest.length === 0) {
    if (existing !== undefined && typeof existing !== 'string') {
      throw new InvalidTranslationKeyError(
        `Translation key segment "${head}" is a group, not a translation value.`,
      );
    }

    return { ...content, [head]: value };
  }

  if (existing !== undefined && typeof existing === 'string') {
    throw new InvalidTranslationKeyError(
      `Translation key segment "${head}" is already a translation value, not a group.`,
    );
  }

  const child = existing ?? {};

  return { ...content, [head]: setTranslationValue(child, rest, value) };
}
