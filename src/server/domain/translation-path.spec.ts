import type { CatalogContent } from './catalog';
import {
  deleteTranslationValue,
  getTranslationValue,
  InvalidTranslationKeyError,
  parseTranslationKeyPath,
  pathExists,
  renameTranslationValue,
  setTranslationValue,
  TranslationKeyCollisionError,
} from './translation-path';

describe('parseTranslationKeyPath', () => {
  it('splits a dot-path key into segments', () => {
    expect(parseTranslationKeyPath('nav.home')).toEqual(['nav', 'home']);
  });

  it('accepts a single-segment key', () => {
    expect(parseTranslationKeyPath('title')).toEqual(['title']);
  });

  it('rejects an empty key', () => {
    expect(() => parseTranslationKeyPath('')).toThrow(
      InvalidTranslationKeyError,
    );
  });

  it('rejects a key with an empty segment', () => {
    expect(() => parseTranslationKeyPath('nav..home')).toThrow(
      'has an empty segment',
    );
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects a "%s" segment anywhere in the path',
    (segment) => {
      expect(() => parseTranslationKeyPath(`nav.${segment}.home`)).toThrow(
        'disallowed segment',
      );
      expect(() => parseTranslationKeyPath(segment)).toThrow(
        'disallowed segment',
      );
    },
  );
});

describe('getTranslationValue', () => {
  const content: CatalogContent = {
    nav: { home: 'Home', docs: 'Docs' },
    title: 'Glossa',
  };

  it('reads an existing nested value', () => {
    expect(getTranslationValue(content, ['nav', 'home'])).toBe('Home');
  });

  it('reads an existing top-level value', () => {
    expect(getTranslationValue(content, ['title'])).toBe('Glossa');
  });

  it('returns undefined for a missing key', () => {
    expect(getTranslationValue(content, ['nav', 'missing'])).toBeUndefined();
  });

  it('returns undefined when descending through a string leaf', () => {
    expect(getTranslationValue(content, ['title', 'nested'])).toBeUndefined();
  });

  it('returns undefined when a group is requested as a value', () => {
    expect(getTranslationValue(content, ['nav'])).toBeUndefined();
  });
});

describe('setTranslationValue', () => {
  it('replaces an existing top-level value without touching siblings', () => {
    const content: CatalogContent = { title: 'Glossa', nav: { home: 'Home' } };
    const next = setTranslationValue(content, ['title'], 'Glossa 2');

    expect(next).toEqual({ title: 'Glossa 2', nav: { home: 'Home' } });
    expect(next['nav']).toBe(content['nav']); // untouched branch is reused, not cloned
  });

  it('replaces an existing nested value', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    const next = setTranslationValue(content, ['nav', 'home'], 'Start');

    expect(next).toEqual({ nav: { home: 'Start', docs: 'Docs' } });
  });

  it('creates a missing nested path', () => {
    const content: CatalogContent = {};
    const next = setTranslationValue(
      content,
      ['nav', 'changelog'],
      'Changelog',
    );

    expect(next).toEqual({ nav: { changelog: 'Changelog' } });
  });

  it('creates a deeply nested missing path', () => {
    const content: CatalogContent = {};
    const next = setTranslationValue(content, ['a', 'b', 'c'], 'value');

    expect(next).toEqual({ a: { b: { c: 'value' } } });
  });

  it('does not mutate the original object', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };
    setTranslationValue(content, ['nav', 'home'], 'Changed');

    expect(content).toEqual({ nav: { home: 'Home' } });
  });

  it('throws when a leaf value is treated as a group', () => {
    const content: CatalogContent = { title: 'Glossa' };

    expect(() =>
      setTranslationValue(content, ['title', 'nested'], 'value'),
    ).toThrow(InvalidTranslationKeyError);
  });

  it('throws when a group is treated as a leaf value', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };

    expect(() => setTranslationValue(content, ['nav'], 'value')).toThrow(
      InvalidTranslationKeyError,
    );
  });
});

describe('pathExists', () => {
  const content: CatalogContent = { nav: { home: 'Home' }, title: 'Glossa' };

  it('is true for an existing leaf', () => {
    expect(pathExists(content, ['nav', 'home'])).toBe(true);
  });

  it('is true for an existing group', () => {
    expect(pathExists(content, ['nav'])).toBe(true);
  });

  it('is false for a missing path', () => {
    expect(pathExists(content, ['nav', 'missing'])).toBe(false);
  });

  it('is false when descending through a string leaf', () => {
    expect(pathExists(content, ['title', 'nested'])).toBe(false);
  });
});

describe('deleteTranslationValue', () => {
  it('deletes a leaf while preserving its sibling', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    const next = deleteTranslationValue(content, ['nav', 'home']);

    expect(next).toEqual({ nav: { docs: 'Docs' } });
  });

  it('prunes a parent left empty by the delete', () => {
    const content: CatalogContent = { legacy: { banner: { title: 'Old' } } };
    const next = deleteTranslationValue(content, ['legacy', 'banner', 'title']);

    expect(next).toEqual({});
  });

  it('prunes multiple empty ancestors, not just the immediate parent', () => {
    const content: CatalogContent = {
      legacy: { banner: { title: 'Old title' } },
      other: 'Kept',
    };
    const next = deleteTranslationValue(content, ['legacy', 'banner', 'title']);

    expect(next).toEqual({ other: 'Kept' });
  });

  it('is a no-op for a missing target value', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };
    const next = deleteTranslationValue(content, ['nav', 'missing']);

    expect(next).toBe(content);
  });

  it('is a no-op when the path addresses a group, not a leaf', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };
    expect(deleteTranslationValue(content, ['nav'])).toBe(content);
  });

  it('preserves a MessageFormat value elsewhere in the catalog untouched', () => {
    const content: CatalogContent = {
      nav: { home: 'Home' },
      greeting: 'Hello {$name}',
    };
    const next = deleteTranslationValue(content, ['nav', 'home']);

    expect(next).toEqual({ greeting: 'Hello {$name}' });
  });

  it('does not mutate the original object', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    deleteTranslationValue(content, ['nav', 'home']);

    expect(content).toEqual({ nav: { home: 'Home', docs: 'Docs' } });
  });

  it('leaves unrelated branches completely untouched (same reference)', () => {
    const content: CatalogContent = {
      nav: { home: 'Home' },
      dialog: { close: 'Close' },
    };
    const next = deleteTranslationValue(content, ['nav', 'home']);

    expect(next['dialog']).toBe(content['dialog']);
  });
});

describe('renameTranslationValue', () => {
  it('renames a simple top-level key', () => {
    const content: CatalogContent = { title: 'Glossa' };
    const next = renameTranslationValue(content, ['title'], ['heading']);

    expect(next).toEqual({ heading: 'Glossa' });
  });

  it('renames nav.home to navigation.home, preserving the exact value', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    const next = renameTranslationValue(
      content,
      ['nav', 'home'],
      ['navigation', 'home'],
    );

    expect(next).toEqual({
      nav: { docs: 'Docs' },
      navigation: { home: 'Home' },
    });
  });

  it('preserves siblings of the renamed key', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    const next = renameTranslationValue(content, ['nav', 'home'], ['title']);

    expect(next['nav']).toEqual({ docs: 'Docs' });
  });

  it('prunes the old parent when it becomes empty', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };
    const next = renameTranslationValue(
      content,
      ['nav', 'home'],
      ['navigation', 'home'],
    );

    expect(next).toEqual({ navigation: { home: 'Home' } });
  });

  it('renames a deeply nested path', () => {
    const content: CatalogContent = {
      checkout: { payment: { title: 'Payment' } },
    };
    const next = renameTranslationValue(
      content,
      ['checkout', 'payment', 'title'],
      ['checkout', 'billing', 'heading'],
    );

    expect(next).toEqual({ checkout: { billing: { heading: 'Payment' } } });
  });

  it('preserves a MessageFormat value byte-for-byte', () => {
    const content: CatalogContent = { greeting: 'Hello {$name}' };
    const next = renameTranslationValue(content, ['greeting'], ['welcome']);

    expect(next['welcome']).toBe('Hello {$name}');
  });

  it('is a no-op when the old path does not exist in this catalog', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };
    const next = renameTranslationValue(
      content,
      ['nav', 'missing'],
      ['nav', 'renamed'],
    );

    expect(next).toBe(content);
  });

  it('rejects a rename onto a path that already exists', () => {
    const content: CatalogContent = {
      nav: { home: 'Home' },
      navigation: { home: 'Inicio' },
    };

    expect(() =>
      renameTranslationValue(content, ['nav', 'home'], ['navigation', 'home']),
    ).toThrow(TranslationKeyCollisionError);
    // Refusing the whole operation means the original content is untouched.
    expect(content).toEqual({
      nav: { home: 'Home' },
      navigation: { home: 'Inicio' },
    });
  });

  it('rejects renaming a key to itself', () => {
    const content: CatalogContent = { nav: { home: 'Home' } };

    expect(() =>
      renameTranslationValue(content, ['nav', 'home'], ['nav', 'home']),
    ).toThrow(InvalidTranslationKeyError);
  });

  it('rejects an unsafe new path via the shared key parser', () => {
    expect(() => parseTranslationKeyPath('nav.__proto__')).toThrow(
      InvalidTranslationKeyError,
    );
  });

  it('does not mutate the original object', () => {
    const content: CatalogContent = { nav: { home: 'Home', docs: 'Docs' } };
    renameTranslationValue(content, ['nav', 'home'], ['navigation', 'home']);

    expect(content).toEqual({ nav: { home: 'Home', docs: 'Docs' } });
  });
});
