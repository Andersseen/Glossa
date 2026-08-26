import { validateCatalogContent } from '../../domain/catalog';

describe('catalog domain validation', () => {
  it('accepts a nested catalog of strings', () => {
    expect(
      validateCatalogContent({
        common: {
          save: 'Save',
          cancel: 'Cancel',
        },
      }),
    ).toEqual({
      common: {
        save: 'Save',
        cancel: 'Cancel',
      },
    });
  });

  it('accepts an empty catalog', () => {
    expect(validateCatalogContent({})).toEqual({});
  });

  it('rejects a non-object root', () => {
    expect(() => validateCatalogContent('not an object')).toThrow(
      'Catalog root must be an object.',
    );
  });

  it('rejects an array root', () => {
    expect(() => validateCatalogContent(['Save', 'Cancel'])).toThrow(
      'Catalog root must be an object.',
    );
  });

  it('rejects a null root', () => {
    expect(() => validateCatalogContent(null)).toThrow(
      'Catalog root must be an object.',
    );
  });

  it('rejects a non-string, non-object leaf', () => {
    expect(() =>
      validateCatalogContent({
        common: {
          count: 42,
        },
      }),
    ).toThrow(
      'Translation value at "common.count" must be a string or object.',
    );
  });

  it('rejects an array leaf', () => {
    expect(() =>
      validateCatalogContent({
        common: {
          tags: ['a', 'b'],
        },
      }),
    ).toThrow('Translation value at "common.tags" must be a string or object.');
  });

  it('rejects a boolean or null leaf', () => {
    expect(() => validateCatalogContent({ flag: true })).toThrow(
      'Translation value at "flag" must be a string or object.',
    );
    expect(() => validateCatalogContent({ flag: null })).toThrow(
      'Translation value at "flag" must be a string or object.',
    );
  });

  it('preserves string values exactly, including MessageFormat 2 syntax', () => {
    const message = '{count, plural, one {# item} other {# items}}';

    expect(validateCatalogContent({ count: message })).toEqual({
      count: message,
    });
  });
});
