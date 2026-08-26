export const SUPPORTED_LOCALES = ['en', 'es', 'uk'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type GlossaCatalog = {
  app: {
    name: string;
    homeLabel: string;
  };
  nav: {
    primaryLabel: string;
    projects: string;
    translations: string;
    upcoming: string;
    openMenu: string;
  };
  language: {
    label: string;
  };
};

export const I18N_CATALOGS: Record<Locale, GlossaCatalog> = {
  en: {
    app: {
      name: 'Glossa',
      homeLabel: 'Glossa projects',
    },
    nav: {
      primaryLabel: 'Product navigation',
      projects: 'Projects',
      translations: 'Translations',
      upcoming: 'Upcoming',
      openMenu: 'Open navigation menu',
    },
    language: {
      label: 'Language',
    },
  },
  es: {
    app: {
      name: 'Glossa',
      homeLabel: 'Proyectos de Glossa',
    },
    nav: {
      primaryLabel: 'Navegación del producto',
      projects: 'Proyectos',
      translations: 'Traducciones',
      upcoming: 'Próximamente',
      openMenu: 'Abrir navegación',
    },
    language: {
      label: 'Idioma',
    },
  },
  uk: {
    app: {
      name: 'Glossa',
      homeLabel: 'Проєкти Glossa',
    },
    nav: {
      primaryLabel: 'Навігація продукту',
      projects: 'Проєкти',
      translations: 'Переклади',
      upcoming: 'Незабаром',
      openMenu: 'Відкрити навігацію',
    },
    language: {
      label: 'Мова',
    },
  },
};
