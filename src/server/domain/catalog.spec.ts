import { countCatalogMessages } from './catalog';

describe('countCatalogMessages', () => {
  it('counts leaf string values, not container objects', () => {
    expect(
      countCatalogMessages({
        nav: { home: 'Home', docs: 'Docs' },
      }),
    ).toBe(2);
  });

  it('counts across multiple levels of nesting', () => {
    expect(
      countCatalogMessages({
        a: 'one',
        b: { c: 'two', d: { e: 'three' } },
      }),
    ).toBe(3);
  });

  it('returns 0 for an empty catalog', () => {
    expect(countCatalogMessages({})).toBe(0);
  });
});
