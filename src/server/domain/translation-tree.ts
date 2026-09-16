import type { CatalogContent } from './catalog';
import { isAddressableTranslationSegment } from './translation-path';

export type TranslationLeaf = {
  key: string;
  value: string;
};

/**
 * One locale's view of a translation key. `exists` is deliberately not `Boolean(value)` — an
 * empty string is a real, stored translation, and a translator who deliberately cleared a value
 * must not see the key reported as missing again.
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

export type TranslationSummary = {
  totalKeys: number;
  completeKeys: number;
  missingKeys: number;
};

/**
 * Depth-first flattening of a stored nested catalog into addressable dot-path leaves, preserving
 * the catalog's own key order — so a subtree stays contiguous and the workspace list reads in the
 * order the catalog was authored, without a sort that would scatter it.
 *
 * Leaves whose path cannot round-trip through `parseTranslationKeyPath` are skipped rather than
 * listed: the workspace's only way to write a key back is that parser, so a row it could never
 * save would be a lie. Such keys stay stored and untouched, and remain editable in the raw JSON
 * editor.
 */
export function flattenCatalogLeaves(
  content: CatalogContent,
): TranslationLeaf[] {
  const leaves: TranslationLeaf[] = [];
  collectLeaves(content, '', leaves);
  return leaves;
}

/** Flattened leaves as a lookup map — built once per locale so the workspace never re-walks a catalog per key. */
export function toTranslationMap(content: CatalogContent): Map<string, string> {
  const map = new Map<string, string>();

  for (const leaf of flattenCatalogLeaves(content)) {
    map.set(leaf.key, leaf.value);
  }

  return map;
}

/**
 * Builds the cross-locale entry list from the already-loaded catalogs. The source locale is
 * canonical: it alone decides which keys exist in the workspace. A key a target locale has and
 * the source does not is left stored and untouched — see `countTargetOnlyKeys` for the
 * diagnostic that surfaces it.
 *
 * `contents` omits a locale whose catalog does not exist yet; that locale simply reports every
 * key as missing, which is why the workspace opens without requiring a target catalog first.
 */
export function buildTranslationEntries(
  sourceLocale: string,
  locales: readonly string[],
  contents: ReadonlyMap<string, CatalogContent>,
): TranslationEntry[] {
  const maps = toLocaleMaps(locales, contents);
  const source = maps.get(sourceLocale) ?? new Map<string, string>();
  const totalLocales = locales.length;

  return [...source].map(([key, sourceValue]) => {
    const values: Record<string, TranslationEntryValue> = {};
    let translatedCount = 0;

    for (const locale of locales) {
      const value = maps.get(locale)?.get(key);

      if (value === undefined) {
        values[locale] = { exists: false };
      } else {
        values[locale] = { exists: true, value };
        translatedCount += 1;
      }
    }

    return {
      key,
      sourceValue,
      values,
      translatedCount,
      totalLocales,
      complete: translatedCount === totalLocales,
    };
  });
}

/** Builds the single entry for one key, with the same completeness semantics as the full list. */
export function buildTranslationEntry(
  key: string,
  sourceLocale: string,
  locales: readonly string[],
  contents: ReadonlyMap<string, CatalogContent>,
): TranslationEntry | null {
  return (
    buildTranslationEntries(sourceLocale, locales, contents).find(
      (entry) => entry.key === key,
    ) ?? null
  );
}

export function summarizeTranslationEntries(
  entries: readonly TranslationEntry[],
): TranslationSummary {
  const completeKeys = entries.filter((entry) => entry.complete).length;

  return {
    totalKeys: entries.length,
    completeKeys,
    missingKeys: entries.length - completeKeys,
  };
}

/**
 * Per target locale, how many stored keys the source locale does not define. Purely diagnostic —
 * this milestone never deletes, migrates, or promotes such a key.
 */
export function countTargetOnlyKeys(
  sourceLocale: string,
  locales: readonly string[],
  contents: ReadonlyMap<string, CatalogContent>,
): Record<string, number> {
  const maps = toLocaleMaps(locales, contents);
  const source = maps.get(sourceLocale) ?? new Map<string, string>();
  const counts: Record<string, number> = {};

  for (const locale of locales) {
    if (locale === sourceLocale) {
      continue;
    }

    const target = maps.get(locale);

    if (!target) {
      continue;
    }

    const extra = [...target.keys()].filter((key) => !source.has(key)).length;

    if (extra > 0) {
      counts[locale] = extra;
    }
  }

  return counts;
}

function toLocaleMaps(
  locales: readonly string[],
  contents: ReadonlyMap<string, CatalogContent>,
): Map<string, Map<string, string>> {
  const maps = new Map<string, Map<string, string>>();

  for (const locale of locales) {
    const content = contents.get(locale);

    if (content) {
      maps.set(locale, toTranslationMap(content));
    }
  }

  return maps;
}

function collectLeaves(
  node: CatalogContent,
  prefix: string,
  leaves: TranslationLeaf[],
): void {
  for (const [segment, value] of Object.entries(node)) {
    if (!isAddressableTranslationSegment(segment)) {
      continue;
    }

    const key = prefix ? `${prefix}.${segment}` : segment;

    if (typeof value === 'string') {
      leaves.push({ key, value });
    } else {
      collectLeaves(value, key, leaves);
    }
  }
}
