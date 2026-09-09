import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LmnArrowLeftStartOnRectangleIcon } from 'lumen-icons/arrow-left-start-on-rectangle';
import { LmnBars3Icon } from 'lumen-icons/bars-3';
import { LmnFolderIcon } from 'lumen-icons/folder';
import { LmnLanguageIcon } from 'lumen-icons/language';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';

import { AuthClient } from '../auth/auth-client';
import {
  I18N_CATALOGS,
  SUPPORTED_LOCALES,
  type Locale,
} from '../i18n/catalogs';
import { UiButton } from '../ui/button';
import { buttonVariants } from '../ui/button/variants';
import {
  UiDrawer,
  UiDrawerClose,
  UiDrawerContent,
  UiDrawerDescription,
  UiDrawerOverlay,
  UiDrawerTitle,
} from '../ui/drawer';
import { UiNativeSelect } from '../ui/select';

@Component({
  selector: 'app-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    LmnArrowLeftStartOnRectangleIcon,
    LmnBars3Icon,
    LmnFolderIcon,
    LmnLanguageIcon,
    LmnXMarkIcon,
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerDescription,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiNativeSelect,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-background text-foreground min-h-screen">
      <aside
        class="border-border bg-card fixed inset-y-0 left-0 hidden w-60 flex-col border-r px-4 py-5 lg:flex"
      >
        <a
          routerLink="/projects"
          class="focus-visible:ring-ring inline-flex rounded-md text-lg font-semibold tracking-normal outline-none focus-visible:ring-2"
          [attr.aria-label]="t().app.homeLabel"
        >
          {{ t().app.name }}
        </a>

        <nav class="mt-8" [attr.aria-label]="t().nav.primaryLabel">
          <ul class="grid gap-1">
            <li>
              <a
                routerLink="/projects"
                routerLinkActive="bg-muted text-foreground"
                [routerLinkActiveOptions]="{ exact: false }"
                class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition outline-none focus-visible:ring-2"
                ariaCurrentWhenActive="page"
              >
                <lmn-folder aria-hidden="true" [size]="16" />
                {{ t().nav.projects }}
              </a>
            </li>
            <li>
              <span
                class="text-muted-foreground/80 flex h-9 items-center justify-between gap-2 rounded-md px-3 text-sm font-medium"
                aria-disabled="true"
              >
                <span class="inline-flex items-center gap-2">
                  <lmn-language aria-hidden="true" [size]="16" />
                  {{ t().nav.translations }}
                </span>
                <span class="text-xs font-normal">{{ t().nav.upcoming }}</span>
              </span>
            </li>
          </ul>
        </nav>

        <div class="border-border mt-auto border-t pt-4">
          @if (auth.user(); as user) {
            <div class="mb-4 grid gap-2">
              <p class="truncate text-sm font-medium">
                {{ user.name || user.email }}
              </p>
              <ui-button
                type="button"
                variant="outline"
                size="sm"
                class="gap-2"
                (click)="logout()"
              >
                <lmn-arrow-left-start-on-rectangle
                  slot="leading"
                  aria-hidden="true"
                  [size]="16"
                />
                Logout
              </ui-button>
            </div>
          }

          <label
            class="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium"
            for="shell-locale"
          >
            <lmn-language aria-hidden="true" [size]="14" />
            {{ t().language.label }}
          </label>
          <select
            id="shell-locale"
            uiNativeSelect
            [value]="locale()"
            (change)="setLocale($any($event.target).value)"
          >
            @for (option of locales; track option) {
              <option [value]="option">{{ option.toUpperCase() }}</option>
            }
          </select>
        </div>
      </aside>

      <header
        class="border-border bg-card sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 lg:hidden"
      >
        <a
          routerLink="/projects"
          class="focus-visible:ring-ring rounded-md font-semibold outline-none focus-visible:ring-2"
          [attr.aria-label]="t().app.homeLabel"
        >
          {{ t().app.name }}
        </a>
        <button
          type="button"
          [class]="menuButtonClass"
          [uiDrawer]="mobileNavigation"
          [attr.aria-label]="t().nav.openMenu"
        >
          <lmn-bars-3 aria-hidden="true" [size]="20" />
        </button>
      </header>

      <main class="min-h-screen lg:pl-60">
        <div class="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 lg:px-10">
          <ng-content />
        </div>
      </main>
    </div>

    <ng-template #mobileNavigation>
      <div uiDrawerOverlay></div>
      <section uiDrawerContent side="left" class="bg-card p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 uiDrawerTitle>{{ t().app.name }}</h2>
            <p uiDrawerDescription class="mt-2">
              {{ t().nav.primaryLabel }}
            </p>
          </div>
          <ui-drawer-close>
            <lmn-x-mark aria-hidden="true" [size]="20" />
          </ui-drawer-close>
        </div>

        <nav class="mt-8" [attr.aria-label]="t().nav.primaryLabel">
          <ul class="grid gap-1">
            <li>
              <a
                routerLink="/projects"
                routerLinkActive="bg-muted text-foreground"
                [routerLinkActiveOptions]="{ exact: false }"
                class="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition outline-none focus-visible:ring-2"
                ariaCurrentWhenActive="page"
              >
                <lmn-folder aria-hidden="true" [size]="16" />
                {{ t().nav.projects }}
              </a>
            </li>
            <li>
              <span
                class="text-muted-foreground/80 flex h-10 items-center justify-between gap-2 rounded-md px-3 text-sm font-medium"
                aria-disabled="true"
              >
                <span class="inline-flex items-center gap-2">
                  <lmn-language aria-hidden="true" [size]="16" />
                  {{ t().nav.translations }}
                </span>
                <span class="text-xs font-normal">{{ t().nav.upcoming }}</span>
              </span>
            </li>
          </ul>
        </nav>

        <div class="border-border mt-8 border-t pt-4">
          @if (auth.user(); as user) {
            <div class="mb-4 grid gap-2">
              <p class="truncate text-sm font-medium">
                {{ user.name || user.email }}
              </p>
              <ui-button
                type="button"
                variant="outline"
                size="sm"
                class="gap-2"
                (click)="logout()"
              >
                <lmn-arrow-left-start-on-rectangle
                  slot="leading"
                  aria-hidden="true"
                  [size]="16"
                />
                Logout
              </ui-button>
            </div>
          }

          <label
            class="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium"
            for="mobile-shell-locale"
          >
            <lmn-language aria-hidden="true" [size]="14" />
            {{ t().language.label }}
          </label>
          <select
            id="mobile-shell-locale"
            uiNativeSelect
            [value]="locale()"
            (change)="setLocale($any($event.target).value)"
          >
            @for (option of locales; track option) {
              <option [value]="option">{{ option.toUpperCase() }}</option>
            }
          </select>
        </div>
      </section>
    </ng-template>
  `,
})
export class AppShell {
  protected readonly auth = inject(AuthClient);
  protected readonly menuButtonClass = buttonVariants({
    variant: 'outline',
    size: 'icon',
  });
  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly locale = signal<Locale>('en');
  protected readonly t = computed(() => I18N_CATALOGS[this.locale()]);

  protected setLocale(locale: string): void {
    if (SUPPORTED_LOCALES.includes(locale as Locale)) {
      this.locale.set(locale as Locale);
    }
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
  }
}
