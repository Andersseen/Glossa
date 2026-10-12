import { i18n, SUPPORTED_LOCALES } from './i18n';

describe('Glossa UI i18n', () => {
  it('defines the source and secondary locales', () => {
    expect(i18n.locales).toEqual([...SUPPORTED_LOCALES]);
    expect(i18n.sourceLocale).toBe('en');
  });

  it('keeps every locale on the same keys as the source', async () => {
    const keys = (catalog: object): string[] => {
      const walk = (value: object, prefix: string): string[] =>
        Object.entries(value).flatMap(([key, child]) =>
          typeof child === 'object' && child !== null
            ? walk(child, `${prefix}${key}.`)
            : [`${prefix}${key}`],
        );
      return walk(catalog, '').sort();
    };
    const en = (await import('./en.json')).default;
    expect(keys((await import('./es.json')).default)).toEqual(keys(en));
    expect(keys((await import('./uk.json')).default)).toEqual(keys(en));
  });
});
