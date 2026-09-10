import type { CatalogContent } from './catalog';
import {
  getTranslationValue,
  InvalidTranslationKeyError,
  parseTranslationKeyPath,
  setTranslationValue,
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
