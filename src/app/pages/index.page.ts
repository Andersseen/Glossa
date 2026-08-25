import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnLanguageIcon } from 'lumen-icons/language';

import {
  I18N_CATALOGS,
  SUPPORTED_LOCALES,
  type Locale,
} from '../i18n/catalogs';
import { UiButton } from '../ui/button';
import { UiCard, UiCardContent } from '../ui/card';

@Component({
  selector: 'app-home',
  imports: [
    UiButton,
    UiCard,
    UiCardContent,
    LmnLanguageIcon,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="bg-background text-foreground min-h-screen">
      <section
        class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10"
      >
        <header class="flex items-center justify-between gap-4">
          <a
            class="text-lg font-semibold tracking-normal"
            href="/"
            aria-label="Glossa home"
          >
            Glossa
          </a>

          <div class="flex items-center gap-2">
            <lmn-language
              ariaLabel="Interface language"
              class="text-muted-foreground"
            />
            <label class="sr-only" for="locale">Interface language</label>
            <select
              id="locale"
              class="border-border bg-card text-foreground focus-visible:ring-ring rounded-md border px-3 py-2 text-sm shadow-sm transition outline-none focus-visible:ring-2"
              [value]="locale()"
              (change)="setLocale($any($event.target).value)"
            >
              @for (option of locales; track option) {
                <option [value]="option">{{ option.toUpperCase() }}</option>
              }
            </select>
          </div>
        </header>

        <div class="grid flex-1 content-center gap-8 py-16 sm:py-20">
          <div class="max-w-3xl" [move]="'fade-up'">
            <p class="text-muted-foreground mb-4 text-sm font-medium">
              {{ t().nav.projects }} / {{ t().nav.translations }}
            </p>
            <h1 class="text-5xl leading-tight font-semibold sm:text-6xl">
              {{ t().app.name }}
            </h1>
            <p class="text-muted-foreground mt-5 max-w-2xl text-lg leading-8">
              Translation infrastructure for your projects.
            </p>
            <div class="mt-8">
              <ui-button type="button">{{ t().nav.projects }}</ui-button>
            </div>
          </div>

          <ui-card class="max-w-2xl" [move]="'fade-up'">
            <ui-card-content class="pt-6">
              <h2 class="text-base font-semibold">Foundation in progress</h2>
              <p class="text-muted-foreground mt-2 text-sm leading-6">
                Glossa is being prepared with Analog, Angular, ForgeCMS,
                Cloudflare D1, Tailwind, Volt UI primitives, Lumen Icons, and
                Angular Movement.
              </p>
            </ui-card-content>
          </ui-card>
        </div>
      </section>
    </main>
  `,
})
export default class Home {
  readonly locales = SUPPORTED_LOCALES;
  readonly locale = signal<Locale>('en');
  readonly t = computed(() => I18N_CATALOGS[this.locale()]);

  setLocale(locale: string): void {
    if (SUPPORTED_LOCALES.includes(locale as Locale)) {
      this.locale.set(locale as Locale);
    }
  }
}
