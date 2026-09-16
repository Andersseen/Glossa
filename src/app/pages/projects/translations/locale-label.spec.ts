import { localeDisplayName } from './locale-label';

describe('localeDisplayName', () => {
  it('returns the language endonym when the runtime knows it', () => {
    expect(localeDisplayName('en')).toBe('English');
    expect(localeDisplayName('es')).toBe('Español');
  });

  it('falls back to the locale code for an unknown or malformed tag', () => {
    expect(localeDisplayName('zz')).toBe('zz');
    expect(localeDisplayName('not a locale')).toBe('not a locale');
  });
});
