import type { CatalogContent } from './catalog';
import {
  buildTranslationEntries,
  buildTranslationEntry,
  countTargetOnlyKeys,
  flattenCatalogLeaves,
  summarizeTranslationEntries,
  toTranslationMap,
} from './translation-tree';

const source: CatalogContent = {
  nav: { home: 'Home', docs: 'Documentation' },
  dialog: { close: 'Close' },
  title: 'Glossa',
};

function contentsOf(
  entries: Record<string, CatalogContent>,
): Map<string, CatalogContent> {
  return new Map(Object.entries(entries));
}

describe('flattenCatalogLeaves', () => {
  it('flattens nested keys into dot-paths in catalog order', () => {
    expect(flattenCatalogLeaves(source)).toEqual([
      { key: 'nav.home', value: 'Home' },
      { key: 'nav.docs', value: 'Documentation' },
      { key: 'dialog.close', value: 'Close' },
      { key: 'title', value: 'Glossa' },
    ]);
  });

  it('counts an empty string as a real leaf', () => {
    expect(flattenCatalogLeaves({ nav: { home: '' } })).toEqual([
      { key: 'nav.home', value: '' },
    ]);
  });

  it('returns nothing for an empty catalog', () => {
    expect(flattenCatalogLeaves({})).toEqual([]);
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'skips a leaf under an unsafe "%s" segment',
    (segment) => {
      const content = JSON.parse(
        `{"nav":{"home":"Home","${segment}":{"x":"unsafe"}}}`,
      ) as CatalogContent;

      expect(flattenCatalogLeaves(content)).toEqual([
        { key: 'nav.home', value: 'Home' },
      ]);
    },
  );

  it('skips a stored segment containing a dot, which no dot-path could address unambiguously', () => {
    const content = JSON.parse(
      '{"nav.home":"Flat","nav":{"home":"Nested"}}',
    ) as CatalogContent;

    expect(flattenCatalogLeaves(content)).toEqual([
      { key: 'nav.home', value: 'Nested' },
    ]);
  });

  it('builds a lookup map of every leaf', () => {
    expect(toTranslationMap(source).get('nav.docs')).toBe('Documentation');
    expect(toTranslationMap(source).has('nav.missing')).toBe(false);
  });
});

describe('buildTranslationEntries', () => {
  it('derives the key list from the source locale only', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es'],
      contentsOf({
        en: { nav: { home: 'Home' } },
        es: { nav: { home: 'Inicio', extra: 'Extra' } },
      }),
    );

    expect(entries.map((entry) => entry.key)).toEqual(['nav.home']);
  });

  it('reports a value per configured locale with counts and completeness', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es', 'uk'],
      contentsOf({
        en: source,
        es: { nav: { home: 'Inicio', docs: 'Documentación' }, title: 'Glossa' },
        uk: { nav: { home: 'Головна' } },
      }),
    );

    expect(entries[0]).toEqual({
      key: 'nav.home',
      sourceValue: 'Home',
      values: {
        en: { exists: true, value: 'Home' },
        es: { exists: true, value: 'Inicio' },
        uk: { exists: true, value: 'Головна' },
      },
      translatedCount: 3,
      totalLocales: 3,
      complete: true,
    });

    expect(entries[1]).toMatchObject({
      key: 'nav.docs',
      values: {
        uk: { exists: false },
      },
      translatedCount: 2,
      totalLocales: 3,
      complete: false,
    });
  });

  it('treats a missing target catalog as every key missing, without failing', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es', 'uk'],
      contentsOf({
        en: { nav: { home: 'Home' } },
        es: { nav: { home: 'Inicio' } },
      }),
    );

    expect(entries[0]?.values['uk']).toEqual({ exists: false });
    expect(entries[0]?.translatedCount).toBe(2);
    expect(entries[0]?.complete).toBe(false);
  });

  it('counts an empty string target value as translated, not missing', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es'],
      contentsOf({ en: { nav: { home: 'Home' } }, es: { nav: { home: '' } } }),
    );

    expect(entries[0]?.values['es']).toEqual({ exists: true, value: '' });
    expect(entries[0]?.complete).toBe(true);
  });

  it('returns no entries when the source catalog does not exist yet', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es'],
      contentsOf({ es: { nav: { home: 'Inicio' } } }),
    );

    expect(entries).toEqual([]);
  });

  it('builds a single entry by key', () => {
    const entry = buildTranslationEntry(
      'dialog.close',
      'en',
      ['en', 'es'],
      contentsOf({ en: source, es: { dialog: { close: 'Cerrar' } } }),
    );

    expect(entry).toMatchObject({ key: 'dialog.close', complete: true });
    expect(
      buildTranslationEntry('nope', 'en', ['en'], contentsOf({ en: source })),
    ).toBeNull();
  });
});

describe('summarizeTranslationEntries', () => {
  it('splits keys into complete and missing', () => {
    const entries = buildTranslationEntries(
      'en',
      ['en', 'es'],
      contentsOf({
        en: source,
        es: { nav: { home: 'Inicio' }, title: 'Glossa' },
      }),
    );

    expect(summarizeTranslationEntries(entries)).toEqual({
      totalKeys: 4,
      completeKeys: 2,
      missingKeys: 2,
    });
  });
});

describe('countTargetOnlyKeys', () => {
  it('counts keys a target locale has that the source locale does not', () => {
    expect(
      countTargetOnlyKeys(
        'en',
        ['en', 'es', 'uk'],
        contentsOf({
          en: { nav: { home: 'Home' } },
          es: { nav: { home: 'Inicio', legacy: 'Viejo', other: 'Otro' } },
          uk: { nav: { home: 'Головна' } },
        }),
      ),
    ).toEqual({ es: 2 });
  });
});
