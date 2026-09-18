import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { LmnPlusIcon } from 'lumen-icons/plus';
import { LmnTrashIcon } from 'lumen-icons/trash';
import { firstValueFrom } from 'rxjs';

import { UiBadge } from '../../ui/badge';
import { UiButton } from '../../ui/button';
import { UiError, UiFormField, UiHint, UiLabel } from '../../ui/form-field';
import { UiInput } from '../../ui/input';
import { UiNativeSelect } from '../../ui/select';
import { UiSeparator } from '../../ui/separator';
import { DeleteProjectPanel } from './delete-project-panel';
import type { Project, SourceLocalePreview } from './project.types';
import {
  localeDisplayName,
  localeOptionLabel,
} from './translations/locale-label';

/** Same shape the server enforces (`LOCALE_PATTERN` in `domain/project.ts`). */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|\d{3})?$/;

/** How many affected keys the impact summary lists before summarizing the rest. */
const KEY_SAMPLE_SIZE = 5;

type PreviewState =
  | { locale: string; status: 'loading' }
  | { locale: string; status: 'error'; message: string }
  | { locale: string; status: 'ready'; data: SourceLocalePreview };

type SettingsStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * The project's editable settings — name, source locale, configured locales — plus the danger
 * zone. The slug is shown read-only: it is part of public delivery URLs and human routes, and a
 * slug migration is deliberately out of scope.
 *
 * Draft state is a set of `linkedSignal`s over the `project` input, so a successful save (the
 * parent adopts the saved project) resets every draft to the persisted values — that reset *is*
 * the "saved" transition, with no separate syncing code.
 */
@Component({
  selector: 'app-project-settings-panel',
  imports: [
    DeleteProjectPanel,
    LmnPlusIcon,
    LmnTrashIcon,
    UiBadge,
    UiButton,
    UiError,
    UiFormField,
    UiHint,
    UiInput,
    UiLabel,
    UiNativeSelect,
    UiSeparator,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <h2 class="text-xl font-semibold">Project settings</h2>
      <p class="text-muted-foreground mt-1 text-sm">
        The project's name, its source locale, and the locales it manages.
      </p>
      <ui-separator class="my-4" />

      @if (!canWrite()) {
        <p class="text-muted-foreground text-sm">
          Only project admins and editors can change project settings.
        </p>
        <dl class="mt-6 grid max-w-3xl gap-6 sm:grid-cols-2">
          <div>
            <dt class="text-muted-foreground text-sm">Name</dt>
            <dd class="mt-1 font-medium">{{ project().name }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Slug</dt>
            <dd class="mt-1 font-medium">{{ project().slug }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Source locale</dt>
            <dd class="mt-1 font-medium">
              {{ optionLabel(project().sourceLocale) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Locales</dt>
            <dd class="mt-1 flex flex-wrap gap-2">
              @for (locale of project().locales; track locale) {
                <ui-badge variant="secondary">{{ locale }}</ui-badge>
              }
            </dd>
          </div>
        </dl>
      } @else {
        <form
          class="grid max-w-3xl gap-6"
          aria-label="Project settings"
          (submit)="save($event)"
          novalidate
        >
          <ui-form-field>
            <ui-label htmlFor="settings-name" [error]="nameInvalid()">
              Name
            </ui-label>
            <ui-input
              id="settings-name"
              [value]="name()"
              (valueChange)="onNameChange($event)"
              autocomplete="off"
              required
              [ariaDescribedBy]="nameInvalid() ? 'settings-name-error' : ''"
            />
            @if (nameInvalid()) {
              <ui-error id="settings-name-error">
                Project name is required.
              </ui-error>
            }
          </ui-form-field>

          <ui-form-field>
            <ui-label htmlFor="settings-slug">Slug</ui-label>
            <ui-input
              id="settings-slug"
              [value]="project().slug"
              readonly
              ariaDescribedBy="settings-slug-hint"
            />
            <ui-hint id="settings-slug-hint">
              The slug cannot be changed here — it is part of this project's
              public delivery URLs and routes.
            </ui-hint>
          </ui-form-field>

          <ui-form-field>
            <ui-label htmlFor="settings-source-locale">Source locale</ui-label>
            <select
              id="settings-source-locale"
              uiNativeSelect
              [value]="sourceLocale()"
              (change)="onSourceChange($any($event.target).value)"
              aria-describedby="settings-source-hint"
            >
              @for (locale of locales(); track locale) {
                <option [value]="locale" [selected]="locale === sourceLocale()">
                  {{ optionLabel(locale) }}
                </option>
              }
            </select>
            <ui-hint id="settings-source-hint">
              The source locale's catalog decides which translation keys are
              canonical. Only configured locales can be chosen.
            </ui-hint>

            <div aria-live="polite">
              @if (preview(); as state) {
                @switch (state.status) {
                  @case ('loading') {
                    <p class="text-muted-foreground mt-2 text-sm">
                      Checking how this changes your translation keys…
                    </p>
                  }
                  @case ('error') {
                    <ui-error class="mt-2 block">{{ state.message }}</ui-error>
                  }
                  @case ('ready') {
                    @if (!state.data.canChange) {
                      <ui-error class="mt-2 block">
                        {{ optionLabel(state.data.nextSourceLocale) }} has no
                        catalog, so it cannot become the source locale yet.
                        Create or import its catalog first.
                      </ui-error>
                    } @else if (requiresConfirmation()) {
                      <div
                        class="border-accent bg-muted mt-2 grid gap-3 rounded-lg border p-4 text-sm"
                        role="group"
                        aria-labelledby="source-impact-title"
                      >
                        <p id="source-impact-title" class="font-medium">
                          Changing the source locale changes which translation
                          keys Glossa considers canonical.
                        </p>
                        <ul class="grid list-disc gap-1 pl-5">
                          @if (state.data.removedCanonicalKeys.length > 0) {
                            <li>
                              {{
                                keyCount(state.data.removedCanonicalKeys.length)
                              }}
                              from
                              {{ optionLabel(state.data.currentSourceLocale) }}
                              will no longer be canonical.
                            </li>
                          }
                          @if (state.data.addedCanonicalKeys.length > 0) {
                            <li>
                              {{
                                keyCount(state.data.addedCanonicalKeys.length)
                              }}
                              from
                              {{ optionLabel(state.data.nextSourceLocale) }}
                              will become canonical.
                            </li>
                          }
                          <li>Catalog content will not be deleted.</li>
                          <li>
                            Applications may need to use the same source locale
                            configuration.
                          </li>
                        </ul>

                        @if (state.data.removedCanonicalKeys.length > 0) {
                          <div>
                            <p
                              class="text-muted-foreground text-xs font-medium"
                            >
                              No longer canonical
                            </p>
                            <p class="mt-1 text-xs break-all">
                              @for (
                                key of sample(state.data.removedCanonicalKeys);
                                track key
                              ) {
                                <code class="mr-2">{{ key }}</code>
                              }
                              @if (
                                state.data.removedCanonicalKeys.length >
                                sampleSize
                              ) {
                                <span class="text-muted-foreground">
                                  and
                                  {{
                                    state.data.removedCanonicalKeys.length -
                                      sampleSize
                                  }}
                                  more
                                </span>
                              }
                            </p>
                          </div>
                        }
                        @if (state.data.addedCanonicalKeys.length > 0) {
                          <div>
                            <p
                              class="text-muted-foreground text-xs font-medium"
                            >
                              Newly canonical
                            </p>
                            <p class="mt-1 text-xs break-all">
                              @for (
                                key of sample(state.data.addedCanonicalKeys);
                                track key
                              ) {
                                <code class="mr-2">{{ key }}</code>
                              }
                              @if (
                                state.data.addedCanonicalKeys.length >
                                sampleSize
                              ) {
                                <span class="text-muted-foreground">
                                  and
                                  {{
                                    state.data.addedCanonicalKeys.length -
                                      sampleSize
                                  }}
                                  more
                                </span>
                              }
                            </p>
                          </div>
                        }

                        <label class="flex items-start gap-2 font-medium">
                          <input
                            type="checkbox"
                            class="border-input mt-0.5 size-4 rounded"
                            [checked]="impactConfirmed()"
                            (change)="
                              impactConfirmed.set($any($event.target).checked)
                            "
                          />
                          I understand which keys will change.
                        </label>
                      </div>
                    } @else {
                      <p class="text-muted-foreground mt-2 text-sm">
                        Both source catalogs define the same keys, so nothing
                        structural changes. Applications may need to use the
                        same source locale configuration.
                      </p>
                    }
                  }
                }
              }
            </div>
          </ui-form-field>

          <fieldset
            class="grid gap-3"
            aria-describedby="settings-locales-hint settings-locale-error"
          >
            <legend class="text-sm font-medium">Configured locales</legend>
            <p id="settings-locales-hint" class="text-muted-foreground text-sm">
              A locale that already has a catalog cannot be removed here, and
              the source locale cannot be removed.
            </p>
            <ul class="flex flex-wrap gap-2">
              @for (locale of locales(); track locale) {
                <li>
                  <ui-badge variant="outline" class="gap-2 py-1 pr-1">
                    {{ locale }}
                    @if (locale === sourceLocale()) {
                      <span class="sr-only">(source locale)</span>
                    }
                    <button
                      type="button"
                      class="text-muted-foreground hover:text-destructive focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40"
                      [attr.aria-label]="'Remove ' + locale"
                      [disabled]="!canRemove(locale)"
                      (click)="removeLocale(locale)"
                    >
                      <lmn-trash aria-hidden="true" [size]="14" />
                    </button>
                  </ui-badge>
                </li>
              }
            </ul>

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

            @if (localeAddError()) {
              <ui-error id="settings-locale-error">
                {{ localeAddError() }}
              </ui-error>
            }
          </fieldset>

          @if (saveError()) {
            <ui-error>{{ saveError() }}</ui-error>
          }

          <div class="flex flex-wrap items-center justify-end gap-3">
            <p
              class="text-muted-foreground mr-auto text-sm"
              role="status"
              aria-live="polite"
            >
              {{ statusText() }}
            </p>
            <ui-button
              type="button"
              variant="outline"
              [disabled]="!dirty() || saving()"
              (click)="discard()"
            >
              Discard changes
            </ui-button>
            <ui-button type="submit" [disabled]="!canSave()">
              {{ saving() ? 'Saving...' : 'Save settings' }}
            </ui-button>
          </div>
        </form>
      }
    </section>

    <app-delete-project-panel [project]="project()" />
  `,
})
export class ProjectSettingsPanel {
  readonly project = input.required<Project>();
  readonly canWrite = input(false);
  /** Locales that currently have a catalog — the ones the server would refuse to remove. */
  readonly catalogLocales = input<string[]>([]);

  readonly saved = output<Project>();

  private readonly http = inject(HttpClient);

  protected readonly sampleSize = KEY_SAMPLE_SIZE;

  protected readonly name = linkedSignal(() => this.project().name);
  protected readonly sourceLocale = linkedSignal(
    () => this.project().sourceLocale,
  );
  protected readonly locales = linkedSignal(() => this.project().locales);
  protected readonly newLocale = signal('');
  protected readonly impactConfirmed = signal(false);

  protected readonly localeAddError = signal('');
  private readonly previewState = signal<PreviewState | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  private readonly justSaved = signal(false);

  protected readonly nameInvalid = computed(() => !this.name().trim());

  protected readonly dirty = computed(() => {
    const project = this.project();

    return (
      this.name().trim() !== project.name ||
      this.sourceLocale() !== project.sourceLocale ||
      !sameList(this.locales(), project.locales)
    );
  });

  private readonly sourceChanged = computed(
    () => this.sourceLocale() !== this.project().sourceLocale,
  );

  /**
   * A preview is only meaningful for a locale the server already knows (a locale added in this
   * same, unsaved edit has no persisted catalog to compare) — for that case the server's own
   * `PROJECT_SOURCE_CATALOG_REQUIRED` check is the gate, and its message is shown on save.
   */
  private readonly needsPreview = computed(
    () =>
      this.sourceChanged() &&
      this.project().locales.includes(this.sourceLocale()),
  );

  /** Ignored automatically once the draft source moves on or the save lands — never a stale answer. */
  protected readonly preview = computed(() => {
    const state = this.previewState();

    return state && this.needsPreview() && state.locale === this.sourceLocale()
      ? state
      : null;
  });

  protected readonly requiresConfirmation = computed(() => {
    const state = this.preview();

    return (
      state?.status === 'ready' &&
      state.data.canChange &&
      (state.data.addedCanonicalKeys.length > 0 ||
        state.data.removedCanonicalKeys.length > 0)
    );
  });

  private readonly saveBlockedBySource = computed(() => {
    if (!this.needsPreview()) {
      return false;
    }

    const state = this.preview();

    // Never save a source change blind while catalogs might exist: wait for the impact.
    if (state?.status !== 'ready') {
      return true;
    }

    return (
      !state.data.canChange ||
      (this.requiresConfirmation() && !this.impactConfirmed())
    );
  });

  protected readonly canSave = computed(
    () =>
      this.dirty() &&
      !this.nameInvalid() &&
      !this.saving() &&
      !this.saveBlockedBySource(),
  );

  protected readonly status = computed<SettingsStatus>(() => {
    if (this.saving()) {
      return 'saving';
    }

    if (this.saveError()) {
      return 'error';
    }

    if (this.dirty()) {
      return 'dirty';
    }

    return this.justSaved() ? 'saved' : 'idle';
  });

  protected readonly statusText = computed(() => {
    switch (this.status()) {
      case 'saving':
        return 'Saving settings…';
      case 'saved':
        return 'Settings saved.';
      case 'dirty':
        return 'You have unsaved changes.';
      default:
        return '';
    }
  });

  protected optionLabel(locale: string): string {
    return localeOptionLabel(locale);
  }

  protected keyCount(count: number): string {
    return `${count} ${count === 1 ? 'key' : 'keys'}`;
  }

  protected sample(keys: string[]): string[] {
    return keys.slice(0, KEY_SAMPLE_SIZE);
  }

  protected onNameChange(value: string): void {
    this.name.set(value);
    this.markEdited();
  }

  protected onSourceChange(value: string): void {
    this.sourceLocale.set(value);
    this.impactConfirmed.set(false);
    this.markEdited();

    if (this.needsPreview()) {
      void this.loadPreview(value);
    } else {
      this.previewState.set(null);
    }
  }

  protected canRemove(locale: string): boolean {
    return (
      this.locales().length > 1 &&
      locale !== this.sourceLocale() &&
      !this.catalogLocales().includes(locale)
    );
  }

  protected addLocale(): void {
    const locale = this.newLocale().trim();
    this.localeAddError.set('');

    if (!locale) {
      this.localeAddError.set('Locale is required.');
      return;
    }

    if (!LOCALE_PATTERN.test(locale)) {
      this.localeAddError.set('Locale format is invalid.');
      return;
    }

    if (this.locales().includes(locale)) {
      this.localeAddError.set('Locale is already configured.');
      return;
    }

    this.locales.update((locales) => [...locales, locale]);
    this.newLocale.set('');
    this.markEdited();
  }

  protected removeLocale(locale: string): void {
    if (!this.canRemove(locale)) {
      return;
    }

    this.locales.update((locales) => locales.filter((item) => item !== locale));
    this.localeAddError.set('');
    this.markEdited();
  }

  protected discard(): void {
    const project = this.project();

    this.name.set(project.name);
    this.sourceLocale.set(project.sourceLocale);
    this.locales.set(project.locales);
    this.newLocale.set('');
    this.localeAddError.set('');
    this.impactConfirmed.set(false);
    this.previewState.set(null);
    this.saveError.set('');
    this.justSaved.set(false);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    this.justSaved.set(false);

    try {
      const response = await firstValueFrom(
        this.http.patch<{ project: Project }>(
          `/api/projects/${encodeURIComponent(this.project().slug)}`,
          {
            name: this.name().trim(),
            sourceLocale: this.sourceLocale(),
            locales: this.locales(),
          },
        ),
      );

      this.impactConfirmed.set(false);
      this.previewState.set(null);
      this.justSaved.set(true);
      // The parent adopts the saved project; the linked drafts above reset to it.
      this.saved.emit(response.project);
    } catch (error) {
      this.saveError.set(
        readSettingsError(error, 'Project settings could not be saved.'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  private markEdited(): void {
    this.justSaved.set(false);
    this.saveError.set('');
  }

  private async loadPreview(locale: string): Promise<void> {
    this.previewState.set({ locale, status: 'loading' });

    try {
      const response = await firstValueFrom(
        this.http.get<{ preview: SourceLocalePreview }>(
          `/api/projects/${encodeURIComponent(this.project().slug)}/source-locale-preview`,
          { params: { locale } },
        ),
      );

      // A slower earlier response must not overwrite the answer for the locale now selected.
      if (this.sourceLocale() === locale) {
        this.previewState.set({
          locale,
          status: 'ready',
          data: response.preview,
        });
      }
    } catch (error) {
      if (this.sourceLocale() === locale) {
        this.previewState.set({
          locale,
          status: 'error',
          message: readSettingsError(
            error,
            `The impact of switching to ${localeDisplayName(locale)} could not be checked.`,
          ),
        });
      }
    }
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function readSettingsError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
