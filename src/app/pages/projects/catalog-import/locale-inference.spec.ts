import { inferLocaleFromFileName } from './locale-inference';

describe('inferLocaleFromFileName', () => {
  it('infers a simple locale from a normal filename', () => {
    expect(inferLocaleFromFileName('en.json')).toBe('en');
  });

  it('infers a region-qualified locale', () => {
    expect(inferLocaleFromFileName('pt-BR.json')).toBe('pt-BR');
  });

  it('is case-insensitive about the extension', () => {
    expect(inferLocaleFromFileName('uk.JSON')).toBe('uk');
  });

  it('returns null for a file with no .json extension', () => {
    expect(inferLocaleFromFileName('en.yaml')).toBeNull();
    expect(inferLocaleFromFileName('en')).toBeNull();
  });

  it('returns whatever precedes .json for a non-standard filename, for manual correction', () => {
    expect(inferLocaleFromFileName('translations-en.json')).toBe(
      'translations-en',
    );
    expect(inferLocaleFromFileName('messages.es.json')).toBe('messages.es');
  });

  it('returns null for a bare .json filename', () => {
    expect(inferLocaleFromFileName('.json')).toBeNull();
  });
});
