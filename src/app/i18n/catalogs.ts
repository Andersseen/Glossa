export const SUPPORTED_LOCALES = ['en', 'es', 'uk'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type GlossaCatalog = {
  app: {
    name: string;
  };
  nav: {
    projects: string;
    translations: string;
  };
};

export const I18N_CATALOGS: Record<Locale, GlossaCatalog> = {
  en: {
    app: {
      name: 'Glossa',
    },
    nav: {
      projects: 'Projects',
      translations: 'Translations',
    },
  },
  es: {
    app: {
      name: 'Glossa',
    },
    nav: {
      projects: 'Proyectos',
      translations: 'Traducciones',
    },
  },
  uk: {
    app: {
      name: 'Glossa',
    },
    nav: {
      projects: 'Проєкти',
      translations: 'Переклади',
    },
  },
};
