import { validateProjectInput } from '../../domain/project';

describe('project domain validation', () => {
  it('accepts a minimal valid project', () => {
    expect(
      validateProjectInput({
        name: 'Marketing Site',
        slug: 'marketing-site',
        sourceLocale: 'en',
        locales: ['en', 'es'],
      }),
    ).toEqual({
      name: 'Marketing Site',
      slug: 'marketing-site',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
  });

  it('rejects invalid slugs', () => {
    expect(() =>
      validateProjectInput({
        name: 'Marketing Site',
        slug: 'Marketing Site',
        sourceLocale: 'en',
        locales: ['en'],
      }),
    ).toThrow('Project slug must be lowercase kebab-case.');
  });

  it('rejects duplicate locales', () => {
    expect(() =>
      validateProjectInput({
        name: 'Marketing Site',
        slug: 'marketing-site',
        sourceLocale: 'en',
        locales: ['en', 'en'],
      }),
    ).toThrow('Locales must be unique.');
  });

  it('accepts BCP 47 style locale tags', () => {
    expect(
      validateProjectInput({
        name: 'Brazil',
        slug: 'brazil',
        sourceLocale: 'pt-BR',
        locales: ['pt-BR', 'en'],
      }),
    ).toMatchObject({
      sourceLocale: 'pt-BR',
      locales: ['pt-BR', 'en'],
    });
  });
});
