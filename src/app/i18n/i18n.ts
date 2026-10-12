import { defineI18n } from '@etyma/core';

import en from './en.json';

export const SUPPORTED_LOCALES = ['en', 'es', 'uk'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Glossa's own UI i18n. `en.json` is the source catalog and the typed key contract; the other
 * locales load lazily so they stay out of the initial bundle.
 */
export const i18n = defineI18n({
  locales: [...SUPPORTED_LOCALES],
  sourceLocale: 'en',
  source: en,
  loaders: {
    es: () => import('./es.json'),
    uk: () => import('./uk.json'),
  },
});
