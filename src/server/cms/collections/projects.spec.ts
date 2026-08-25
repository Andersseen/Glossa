import { defineProject } from '../../domain/project';

describe('project schema foundation', () => {
  it('accepts a minimal valid project', () => {
    expect(
      defineProject({
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
      defineProject({
        name: 'Marketing Site',
        slug: 'Marketing Site',
        sourceLocale: 'en',
        locales: ['en'],
      }),
    ).toThrow('Project slug must be lowercase kebab-case.');
  });
});
