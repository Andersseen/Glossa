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

import { UiButton } from '../../ui/button';

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
    RouterLink,
    UiButton,
    LmnArrowLeftIcon,
    LmnPlusIcon,
    LmnTrashIcon,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="bg-background text-foreground min-h-screen">
      <section class="mx-auto w-full max-w-3xl px-6 py-8 sm:px-8 lg:px-10">
        <a
          routerLink="/projects"
          class="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium transition"
        >
          <lmn-arrow-left aria-hidden="true" [size]="16" />
          Projects
        </a>

        <header class="mt-8" [move]="'fade-up'">
          <h1 class="text-3xl font-semibold tracking-normal">New project</h1>
          <p class="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
            Define the project identity and the locales it can manage.
          </p>
        </header>

        <form
          class="mt-10 grid gap-6"
          [move]="'fade-up'"
          (submit)="submit($event)"
        >
          <div class="grid gap-2">
            <label class="text-sm font-medium" for="name">Name</label>
            <input
              id="name"
              class="border-border bg-card focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
              [value]="name()"
              (input)="setName($any($event.target).value)"
              autocomplete="off"
            />
            @if (submitted() && !name().trim()) {
              <p class="text-destructive text-sm">Project name is required.</p>
            }
          </div>

          <div class="grid gap-2">
            <label class="text-sm font-medium" for="slug">Slug</label>
            <input
              id="slug"
              class="border-border bg-card focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
              [value]="slug()"
              (input)="setSlug($any($event.target).value)"
              autocomplete="off"
            />
            @if (submitted() && !validSlug()) {
              <p class="text-destructive text-sm">
                Use lowercase kebab-case, for example volt-ui.
              </p>
            }
          </div>

          <div class="grid gap-2">
            <label class="text-sm font-medium" for="sourceLocale">
              Source locale
            </label>
            <select
              id="sourceLocale"
              class="border-border bg-card focus-visible:ring-ring h-10 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
              [value]="sourceLocale()"
              (change)="sourceLocale.set($any($event.target).value)"
            >
              @for (locale of locales(); track locale) {
                <option [value]="locale">{{ locale }}</option>
              }
            </select>
            @if (submitted() && !sourceLocaleValid()) {
              <p class="text-destructive text-sm">
                Source locale must be one of the selected locales.
              </p>
            }
          </div>

          <fieldset class="grid gap-3">
            <legend class="text-sm font-medium">Locales</legend>
            <div class="flex flex-wrap gap-2">
              @for (locale of locales(); track locale) {
                <span
                  class="border-border bg-card inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm"
                >
                  {{ locale }}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-destructive focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-md outline-none focus-visible:ring-2"
                    [attr.aria-label]="'Remove ' + locale"
                    (click)="removeLocale(locale)"
                  >
                    <lmn-trash aria-hidden="true" [size]="14" />
                  </button>
                </span>
              }
            </div>

            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                class="border-border bg-card focus-visible:ring-ring h-10 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 sm:flex-1"
                [value]="newLocale()"
                (input)="newLocale.set($any($event.target).value)"
                placeholder="pt-BR"
                aria-label="New locale"
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
              <p class="text-destructive text-sm">{{ localeError() }}</p>
            }
          </fieldset>

          @if (serverError()) {
            <p class="text-destructive text-sm">{{ serverError() }}</p>
          }

          <div class="flex justify-end gap-3">
            <a
              routerLink="/projects"
              class="border-border bg-card hover:bg-muted focus-visible:ring-ring inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition outline-none focus-visible:ring-2"
            >
              Cancel
            </a>
            <ui-button type="submit" [disabled]="submitting()">
              {{ submitting() ? 'Creating...' : 'Create project' }}
            </ui-button>
          </div>
        </form>
      </section>
    </main>
  `,
})
export default class ProjectNewPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

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
