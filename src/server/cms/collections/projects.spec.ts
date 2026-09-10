import { mergeProjectInput, validateProjectInput } from '../../domain/project';

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
      publicDelivery: false,
    });
  });

  it('accepts an explicit publicDelivery flag', () => {
    expect(
      validateProjectInput({
        name: 'Marketing Site',
        slug: 'marketing-site',
        sourceLocale: 'en',
        locales: ['en'],
        publicDelivery: true,
      }),
    ).toMatchObject({ publicDelivery: true });
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

  it('rejects a source locale outside the locale list', () => {
    expect(() =>
      validateProjectInput({
        name: 'Marketing Site',
        slug: 'marketing-site',
        sourceLocale: 'en',
        locales: ['es'],
      }),
    ).toThrow('Locales must include the source locale.');
  });

  it('merges project updates before validation', () => {
    expect(
      mergeProjectInput(
        {
          id: 'project-1',
          name: 'Marketing Site',
          slug: 'marketing-site',
          sourceLocale: 'en',
          locales: ['en', 'es'],
          publicDelivery: true,
        },
        { name: 'Docs Site' },
      ),
    ).toEqual({
      name: 'Docs Site',
      slug: 'marketing-site',
      sourceLocale: 'en',
      locales: ['en', 'es'],
      // Omitted from the patch — the existing value carries forward untouched.
      publicDelivery: true,
    });
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
