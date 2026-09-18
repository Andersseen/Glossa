import { localeDisplayName, localeOptionLabel } from './locale-label';

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

describe('localeOptionLabel', () => {
  it('pairs the display name with the code', () => {
    expect(localeOptionLabel('es')).toBe('Español / es');
    expect(localeOptionLabel('en')).toBe('English / en');
  });

  it('is just the code when no display name is known', () => {
    expect(localeOptionLabel('zz')).toBe('zz');
  });
});
