import type { CatalogContent } from './catalog';

export class InvalidTranslationKeyError extends Error {
  readonly code = 'INVALID_TRANSLATION_KEY';

  constructor(message: string) {
    super(message);
  }
}

export class TranslationKeyCollisionError extends Error {
  readonly code = 'TRANSLATION_KEY_COLLISION';

  constructor(key: string) {
    super(`Translation key "${key}" already exists.`);
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

/**
 * Whether a *stored* catalog key segment can be addressed by a dot-path key at all. The inverse
 * direction of `parseTranslationKeyPath`: that function guards keys coming *in* from a client,
 * this one guards keys going *out* of a catalog the workspace flattens into dot-paths. Both read
 * the same `DANGEROUS_SEGMENTS` set — there is deliberately no second notion of "disallowed
 * segment" anywhere. A segment containing a literal `.` is rejected here (and only here): it has
 * no effect on parsing, but `{"nav.home": "A", "nav": {"home": "B"}}` would otherwise flatten to
 * the same dot-path twice, and writing that key back would silently land on the nested one.
 */
export function isAddressableTranslationSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !segment.includes('.') &&
    !DANGEROUS_SEGMENTS.has(segment)
  );
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
 * Whether *anything* — a leaf value or a group — is stored at `path`. Unlike `getTranslationValue`
 * this does not care about the node's type, because a rename/delete collision check must refuse a
 * target path that is currently a group just as much as one that is already a translation value;
 * either way, writing there would silently destroy existing structure.
 */
export function pathExists(content: CatalogContent, path: string[]): boolean {
  let node: string | CatalogContent | undefined = content;

  for (const segment of path) {
    if (typeof node !== 'object' || node === null) {
      return false;
    }

    node = node[segment];
  }

  return node !== undefined;
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

/**
 * Returns a new catalog content object with the leaf at `path` removed, pruning any ancestor
 * group along that path that becomes empty as a result — but never an ancestor that still has
 * other children, and never a branch `path` does not touch. A `path` that does not resolve to an
 * existing leaf (already absent, or currently a group) is a no-op: the same `content` reference is
 * returned unchanged, so a caller can cheaply tell "nothing happened" from `result === content`.
 */
export function deleteTranslationValue(
  content: CatalogContent,
  path: string[],
): CatalogContent {
  const head = path[0];

  if (head === undefined) {
    throw new InvalidTranslationKeyError('Translation key path is empty.');
  }

  const existing = content[head];

  if (existing === undefined) {
    return content;
  }

  const rest = path.slice(1);

  if (rest.length === 0) {
    if (typeof existing !== 'string') {
      return content;
    }

    const next = { ...content };
    delete next[head];
    return next;
  }

  if (typeof existing === 'string') {
    return content;
  }

  const child = deleteTranslationValue(existing, rest);

  if (child === existing) {
    return content;
  }

  if (Object.keys(child).length === 0) {
    const next = { ...content };
    delete next[head];
    return next;
  }

  return { ...content, [head]: child };
}

/**
 * Moves the value at `oldPath` to `newPath` within one catalog, preserving it exactly (never
 * parsed or reformatted — MessageFormat placeholders like `{$count :number}` are just characters
 * here) and pruning any old parent group left empty. Implemented on top of `getTranslationValue`,
 * `deleteTranslationValue`, and `setTranslationValue` rather than as a third traversal, so pruning
 * and immutability stay in exactly one place each.
 *
 * A `content` that does not have `oldPath` at all is a no-op (`content` returned unchanged) — a
 * target locale that never had the key stays without it, it does not gain an empty value. A
 * `newPath` that already resolves to *anything* (a value or a group) in `content` is refused: the
 * caller (the project-wide lifecycle service) is expected to have already preflighted this across
 * every catalog, so reaching this here would mean a real, unresolved conflict.
 */
export function renameTranslationValue(
  content: CatalogContent,
  oldPath: string[],
  newPath: string[],
): CatalogContent {
  if (pathsEqual(oldPath, newPath)) {
    throw new InvalidTranslationKeyError(
      'The new key must be different from the current key.',
    );
  }

  const value = getTranslationValue(content, oldPath);

  if (value === undefined) {
    return content;
  }

  if (pathExists(content, newPath)) {
    throw new TranslationKeyCollisionError(newPath.join('.'));
  }

  return setTranslationValue(
    deleteTranslationValue(content, oldPath),
    newPath,
    value,
  );
}

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return (
    a.length === b.length && a.every((segment, index) => segment === b[index])
  );
}
