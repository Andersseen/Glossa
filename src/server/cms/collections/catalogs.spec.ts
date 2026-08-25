import { defineCatalog } from '../../domain/catalog';

describe('catalog schema foundation', () => {
  it('accepts a minimal valid catalog', () => {
    expect(
      defineCatalog({
        project: 'marketing-site',
        locale: 'en',
        content: {
          app: {
            title: 'Marketing',
          },
        },
      }),
    ).toEqual({
      project: 'marketing-site',
      locale: 'en',
      content: {
        app: {
          title: 'Marketing',
        },
      },
    });
  });

  it('rejects empty content', () => {
    expect(() =>
      defineCatalog({
        project: 'marketing-site',
        locale: 'en',
        content: {},
      }),
    ).toThrow('Catalog content cannot be empty.');
  });
});
