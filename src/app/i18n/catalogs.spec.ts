import { I18N_CATALOGS } from './catalogs';

describe('Glossa UI i18n catalog foundation', () => {
  it('renders the source app and navigation labels', () => {
    expect(I18N_CATALOGS.en.app.name).toBe('Glossa');
    expect(I18N_CATALOGS.en.nav.primaryLabel).toBe('Product navigation');
    expect(I18N_CATALOGS.en.nav.projects).toBe('Projects');
    expect(I18N_CATALOGS.en.nav.translations).toBe('Translations');
    expect(I18N_CATALOGS.en.language.label).toBe('Language');
  });

  it('includes the initial secondary locales', () => {
    expect(I18N_CATALOGS.es.nav.projects).toBe('Proyectos');
    expect(I18N_CATALOGS.uk.nav.projects).toBe('Проєкти');
  });
});
