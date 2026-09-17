import type { CatalogContent } from './catalog';
import {
  analyzeTranslations,
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

describe('analyzeTranslations', () => {
  it('reports the source locale as fully covered with no missing/extra keys', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en'],
      contentsOf({ en: source }),
    );

    expect(analysis.sourceKeys).toBe(4);
    expect(analysis.locales[0]).toEqual({
      locale: 'en',
      isSource: true,
      catalogExists: true,
      totalSourceKeys: 4,
      translatedKeys: 4,
      missingKeys: [],
      extraKeys: [],
      coverage: 1,
    });
  });

  it('reports a target locale missing one key, in source order', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({
        en: { nav: { home: 'Home', docs: 'Docs' }, title: 'Glossa' },
        es: { nav: { home: 'Inicio' }, title: 'Glossa' },
      }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es).toMatchObject({
      catalogExists: true,
      totalSourceKeys: 3,
      translatedKeys: 2,
      missingKeys: ['nav.docs'],
      extraKeys: [],
      coverage: 2 / 3,
    });
  });

  it('reports several missing keys in source-catalog order', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({
        en: { a: 'A', b: 'B', c: 'C' },
        es: {},
      }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es?.missingKeys).toEqual(['a', 'b', 'c']);
    expect(es?.translatedKeys).toBe(0);
    expect(es?.coverage).toBe(0);
  });

  it('treats a missing target catalog as every source key missing, with zero coverage', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'uk'],
      contentsOf({ en: { nav: { home: 'Home' } } }),
    );

    const uk = analysis.locales.find((locale) => locale.locale === 'uk');
    expect(uk).toEqual({
      locale: 'uk',
      isSource: false,
      catalogExists: false,
      totalSourceKeys: 1,
      translatedKeys: 0,
      missingKeys: ['nav.home'],
      extraKeys: [],
      coverage: 0,
    });
  });

  it('lists a single target-only key as extra, not missing', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({
        en: { nav: { home: 'Home' } },
        es: { nav: { home: 'Inicio' }, legacy: { banner: 'Viejo' } },
      }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es?.missingKeys).toEqual([]);
    expect(es?.extraKeys).toEqual(['legacy.banner']);
    expect(es?.coverage).toBe(1);
  });

  it('lists several target-only keys in the target catalog’s own order', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({
        en: { nav: { home: 'Home' } },
        es: {
          zeta: 'Z',
          nav: { home: 'Inicio' },
          alpha: 'A',
        },
      }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es?.extraKeys).toEqual(['zeta', 'alpha']);
  });

  it('counts an empty string target value as translated, not missing', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({ en: { nav: { home: 'Home' } }, es: { nav: { home: '' } } }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es?.missingKeys).toEqual([]);
    expect(es?.translatedKeys).toBe(1);
    expect(es?.coverage).toBe(1);
  });

  it('reports a null coverage, not a division by zero, when the source catalog does not exist', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es'],
      contentsOf({ es: { nav: { home: 'Inicio' } } }),
    );

    expect(analysis.sourceKeys).toBe(0);

    const en = analysis.locales.find((locale) => locale.locale === 'en');
    expect(en).toEqual({
      locale: 'en',
      isSource: true,
      catalogExists: false,
      totalSourceKeys: 0,
      translatedKeys: 0,
      missingKeys: [],
      extraKeys: [],
      coverage: null,
    });

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    expect(es).toMatchObject({
      catalogExists: true,
      totalSourceKeys: 0,
      translatedKeys: 0,
      missingKeys: [],
      // Nothing is "extra" against an undefined source key set either — there is nothing to diff.
      extraKeys: ['nav.home'],
      coverage: null,
    });
  });

  it('derives project-wide complete/incomplete counts across multiple locales independently', () => {
    const analysis = analyzeTranslations(
      'en',
      ['en', 'es', 'uk'],
      contentsOf({
        en: { a: 'A', b: 'B', c: 'C' },
        es: { a: 'A', b: 'B' },
        uk: { a: 'A', c: 'C' },
      }),
    );

    const es = analysis.locales.find((locale) => locale.locale === 'es');
    const uk = analysis.locales.find((locale) => locale.locale === 'uk');
    expect(es?.missingKeys).toEqual(['c']);
    expect(uk?.missingKeys).toEqual(['b']);
    expect(analysis.completeKeys).toBe(1);
    expect(analysis.incompleteKeys).toBe(2);
  });
});
