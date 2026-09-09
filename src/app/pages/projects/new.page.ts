import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnArrowLeftIcon } from 'lumen-icons/arrow-left';
import { LmnPlusIcon } from 'lumen-icons/plus';
import { LmnTrashIcon } from 'lumen-icons/trash';
import { firstValueFrom } from 'rxjs';

import { AuthClient } from '../../auth/auth-client';
import { AppShell } from '../../layout/app-shell';
import { PageHeader } from '../../layout/page-header';
import { UiBadge } from '../../ui/badge';
import { UiButton } from '../../ui/button';
import { buttonVariants } from '../../ui/button/variants';
import { UiError, UiFormField, UiHint, UiLabel } from '../../ui/form-field';
import { UiInput } from '../../ui/input';
import { UiNativeSelect } from '../../ui/select';

type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
};

@Component({
  selector: 'app-project-new',
  imports: [
    AppShell,
    PageHeader,
    RouterLink,
    UiBadge,
    UiButton,
    UiError,
    UiFormField,
    UiHint,
    UiInput,
    UiLabel,
    UiNativeSelect,
    LmnArrowLeftIcon,
    LmnPlusIcon,
    LmnTrashIcon,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <a routerLink="/projects" [class]="backLinkClass">
        <lmn-arrow-left aria-hidden="true" [size]="16" />
        Projects
      </a>

      <app-page-header
        class="mt-8"
        title="New project"
        description="Define the project identity and the locales it can manage."
        [move]="'fade-up'"
      />

      <form
        class="mt-10 grid max-w-3xl gap-6"
        [move]="'fade-up'"
        (submit)="submit($event)"
        novalidate
      >
        <ui-form-field>
          <ui-label htmlFor="name" [error]="submitted() && !name().trim()">
            Name
          </ui-label>
          <ui-input
            id="name"
            [value]="name()"
            (valueChange)="setName($event)"
            autocomplete="off"
            required
            [ariaDescribedBy]="
              submitted() && !name().trim() ? 'name-error' : ''
            "
          />
          @if (submitted() && !name().trim()) {
            <ui-error id="name-error">Project name is required.</ui-error>
          }
        </ui-form-field>

        <ui-form-field>
          <ui-label htmlFor="slug" [error]="submitted() && !validSlug()">
            Slug
          </ui-label>
          <ui-input
            id="slug"
            [value]="slug()"
            (valueChange)="setSlug($event)"
            autocomplete="off"
            required
            [ariaDescribedBy]="
              submitted() && !validSlug() ? 'slug-error' : 'slug-hint'
            "
          />
          <ui-hint id="slug-hint">Use lowercase kebab-case.</ui-hint>
          @if (submitted() && !validSlug()) {
            <ui-error id="slug-error">
              Use lowercase kebab-case, for example volt-ui.
            </ui-error>
          }
        </ui-form-field>

        <ui-form-field>
          <ui-label
            htmlFor="sourceLocale"
            [error]="submitted() && !sourceLocaleValid()"
          >
            Source locale
          </ui-label>
          <select
            id="sourceLocale"
            uiNativeSelect
            [value]="sourceLocale()"
            (change)="sourceLocale.set($any($event.target).value)"
            [attr.aria-describedby]="
              submitted() && !sourceLocaleValid() ? 'source-locale-error' : null
            "
          >
            @for (locale of locales(); track locale) {
              <option [value]="locale">{{ locale }}</option>
            }
          </select>
          @if (submitted() && !sourceLocaleValid()) {
            <ui-error id="source-locale-error">
              Source locale must be one of the selected locales.
            </ui-error>
          }
        </ui-form-field>

        <fieldset
          class="grid gap-3"
          aria-describedby="locales-hint locale-error"
        >
          <legend class="text-sm font-medium">Locales</legend>
          <p id="locales-hint" class="text-muted-foreground text-sm">
            Add every locale this project will eventually manage.
          </p>
          <div class="flex flex-wrap gap-2">
            @for (locale of locales(); track locale) {
              <ui-badge variant="outline" class="gap-2 py-1 pr-1">
                {{ locale }}
                <button
                  type="button"
                  class="text-muted-foreground hover:text-destructive focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2"
                  [attr.aria-label]="'Remove ' + locale"
                  (click)="removeLocale(locale)"
                >
                  <lmn-trash aria-hidden="true" [size]="14" />
                </button>
              </ui-badge>
            }
          </div>

          <div class="flex flex-col gap-2 sm:flex-row">
            <ui-input
              class="min-w-0 sm:flex-1"
              [value]="newLocale()"
              (valueChange)="newLocale.set($event)"
              placeholder="pt-BR"
              ariaLabel="New locale"
              autocomplete="off"
            />
            <ui-button
              type="button"
              variant="outline"
              class="gap-2"
              (click)="addLocale()"
            >
              <lmn-plus slot="leading" aria-hidden="true" [size]="16" />
              Add locale
            </ui-button>
          </div>

          @if (localeError()) {
            <ui-error id="locale-error">{{ localeError() }}</ui-error>
          }
        </fieldset>

        @if (serverError()) {
          <ui-error>{{ serverError() }}</ui-error>
        }

        <div class="flex justify-end gap-3">
          <a routerLink="/projects" [class]="cancelLinkClass"> Cancel </a>
          <ui-button type="submit" [disabled]="submitting()">
            {{ submitting() ? 'Creating...' : 'Create project' }}
          </ui-button>
        </div>
      </form>
    </app-shell>
  `,
})
export default class ProjectNewPage {
  private readonly auth = inject(AuthClient);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  protected readonly backLinkClass = buttonVariants({
    variant: 'ghost',
    size: 'sm',
  });
  protected readonly cancelLinkClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });
  protected readonly name = signal('');
  protected readonly slug = signal('');
  protected readonly sourceLocale = signal('en');
  protected readonly locales = signal(['en']);
  protected readonly newLocale = signal('');
  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly serverError = signal('');
  private readonly slugEdited = signal(false);
  private readonly localeAddError = signal('');

  protected readonly validSlug = computed(() =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(this.slug()),
  );
  protected readonly sourceLocaleValid = computed(() =>
    this.locales().includes(this.sourceLocale()),
  );
  protected readonly localeError = computed(() => {
    if (this.localeAddError()) {
      return this.localeAddError();
    }

    if (this.submitted() && this.locales().length === 0) {
      return 'At least one locale is required.';
    }

    return '';
  });
  private readonly formValid = computed(
    () =>
      Boolean(this.name().trim()) &&
      this.validSlug() &&
      this.locales().length > 0 &&
      this.sourceLocaleValid(),
  );

  constructor() {
    void this.auth.loadCurrentUser();
  }

  protected setName(value: string): void {
    this.name.set(value);

    if (!this.slugEdited()) {
      this.slug.set(slugify(value));
    }
  }

  protected setSlug(value: string): void {
    this.slugEdited.set(true);
    this.slug.set(value.trim());
  }

  protected addLocale(): void {
    const locale = this.newLocale().trim();
    this.localeAddError.set('');

    if (!locale) {
      this.localeAddError.set('Locale is required.');
      return;
    }

    if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|\d{3})?$/.test(locale)) {
      this.localeAddError.set('Locale format is invalid.');
      return;
    }

    if (this.locales().includes(locale)) {
      this.localeAddError.set('Locale is already selected.');
      return;
    }

    this.locales.update((locales) => [...locales, locale]);
    this.newLocale.set('');
  }

  protected removeLocale(locale: string): void {
    this.locales.update((locales) => locales.filter((item) => item !== locale));

    if (this.sourceLocale() === locale) {
      this.sourceLocale.set(this.locales()[0] ?? '');
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    this.serverError.set('');

    if (!this.formValid()) {
      return;
    }

    this.submitting.set(true);

    try {
      const response = await firstValueFrom(
        this.http.post<{ project: Project }>('/api/projects', {
          name: this.name().trim(),
          slug: this.slug().trim(),
          sourceLocale: this.sourceLocale(),
          locales: this.locales(),
        }),
      );

      await this.router.navigate(['/projects', response.project.slug]);
    } catch (error) {
      this.serverError.set(readProjectError(error));
    } finally {
      this.submitting.set(false);
    }
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readProjectError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Project could not be created.';
}
