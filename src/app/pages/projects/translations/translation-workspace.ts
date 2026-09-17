import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  type OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UiBadge } from '../../../ui/badge';
import { UiButton } from '../../../ui/button';
import { UiError, UiFormField, UiLabel } from '../../../ui/form-field';
import { UiInput } from '../../../ui/input';
import { UiSkeleton } from '../../../ui/skeleton';
import { cn } from '../../../ui/utils';
import { AddTranslationPanel } from './add-translation-panel';
import { DeleteKeyPanel } from './delete-key-panel';
import { RenameKeyPanel } from './rename-key-panel';
import { TranslationKeyEditor } from './translation-key-editor';
import type {
  TranslationCatalogState,
  TranslationEntry,
  TranslationFieldChange,
  TranslationFilter,
  TranslationWorkspaceProject,
  TranslationWorkspaceResponse,
  TranslationWriteResponse,
} from './translation-workspace.types';

type KeyGroup = {
  id: string;
  label: string;
  entries: TranslationEntry[];
};

const FILTER_BASE =
  'rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

const FILTERS: { value: TranslationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'complete', label: 'Complete' },
];

@Component({
  selector: 'app-translation-workspace',
  imports: [
    AddTranslationPanel,
    DeleteKeyPanel,
    RenameKeyPanel,
    RouterLink,
    TranslationKeyEditor,
    UiBadge,
    UiButton,
    UiError,
    UiFormField,
    UiInput,
    UiLabel,
    UiSkeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="grid gap-4" aria-label="Loading translations">
        <ui-skeleton width="18rem" height="1.25rem" />
        <ui-skeleton width="100%" height="2.5rem" />
        <ui-skeleton width="100%" height="18rem" />
      </div>
    } @else if (loadError()) {
      <div class="grid justify-items-start gap-3">
        <ui-error>{{ loadError() }}</ui-error>
        <ui-button type="button" variant="outline" (click)="reload()">
          Try again
        </ui-button>
      </div>
    } @else if (project(); as project) {
      <section class="grid gap-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <dl class="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <dt class="text-muted-foreground text-xs font-medium">Keys</dt>
              <dd class="text-lg font-semibold">{{ summary().totalKeys }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs font-medium">
                Complete
              </dt>
              <dd class="text-lg font-semibold">
                {{ summary().completeKeys }}
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-xs font-medium">
                Missing translations
              </dt>
              <dd class="text-lg font-semibold">
                {{ summary().missingKeys }}
              </dd>
            </div>
          </dl>
          @if (canWrite()) {
            <app-add-translation-panel
              [projectSlug]="project.slug"
              [sourceLocale]="project.sourceLocale"
              [locales]="project.locales"
              [catalogs]="catalogs()"
              (created)="onCreated($event)"
            />
          }
        </div>

        <div class="flex flex-wrap items-end gap-4">
          <ui-form-field class="max-w-sm min-w-[14rem] flex-1">
            <ui-label class="sr-only" htmlFor="translation-search">
              Search translations
            </ui-label>
            <ui-input
              id="translation-search"
              type="search"
              [value]="search()"
              (valueChange)="search.set($event)"
              placeholder="Search translations..."
            />
          </ui-form-field>

          <div
            class="border-input inline-flex items-center gap-1 rounded-lg border p-1"
            role="group"
            aria-label="Filter translations"
          >
            @for (option of filters; track option.value) {
              <button
                type="button"
                [attr.aria-pressed]="filter() === option.value"
                (click)="filter.set(option.value)"
                [class]="filterClass(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </div>

        @if (targetOnlyNotes().length > 0) {
          <p class="text-muted-foreground text-xs">
            {{ targetOnlyNotes().join(' · ') }}. These stay stored and can be
            edited in the
            <a
              [routerLink]="[
                '/projects',
                project.slug,
                'catalogs',
                project.sourceLocale,
              ]"
              class="underline underline-offset-4"
              >raw JSON catalogs</a
            >.
          </p>
        }

        <div
          class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
        >
          <div class="border-border overflow-hidden rounded-lg border">
            @if (visibleEntries().length === 0) {
              <p class="text-muted-foreground p-6 text-sm">
                @if (entries().length === 0) {
                  No translation keys yet. Add one, or import an existing
                  catalog from the Overview tab.
                } @else {
                  No translation keys match this search or filter.
                }
              </p>
            } @else {
              <div class="max-h-[32rem] overflow-y-auto">
                @for (group of groups(); track group.id) {
                  <h3
                    class="bg-muted text-muted-foreground sticky top-0 px-4 py-2 font-mono text-xs font-semibold"
                  >
                    {{ group.label }}
                  </h3>
                  <ul>
                    @for (entry of group.entries; track entry.key) {
                      <li>
                        <button
                          type="button"
                          (click)="select(entry.key)"
                          [attr.aria-current]="
                            selectedKey() === entry.key ? 'true' : null
                          "
                          class="border-border hover:bg-muted focus-visible:ring-ring aria-[current]:bg-muted grid w-full gap-1 border-b px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        >
                          <span class="font-mono text-sm font-medium break-all">
                            {{ entry.key }}
                          </span>
                          <span
                            class="text-muted-foreground line-clamp-1 text-sm"
                          >
                            {{ entry.sourceValue }}
                          </span>
                          <span class="flex flex-wrap items-center gap-2 pt-1">
                            <span class="text-muted-foreground text-xs">
                              {{ entry.translatedCount }} /
                              {{ entry.totalLocales }}
                            </span>
                            @if (!entry.complete) {
                              <ui-badge variant="destructive">Missing</ui-badge>
                            }
                          </span>
                        </button>
                      </li>
                    }
                  </ul>
                }
              </div>
            }
          </div>

          <div class="border-border rounded-lg border p-5">
            @if (selectedEntry(); as entry) {
              <app-translation-key-editor
                [entry]="entry"
                [sourceLocale]="project.sourceLocale"
                [locales]="project.locales"
                [canWrite]="canWrite()"
                [saving]="saving()"
                [saved]="justSaved()"
                [error]="saveError()"
                (save)="save($event)"
                (dirtyChange)="keyDirty.set($event)"
              />
              @if (conflicted()) {
                <div class="mt-4">
                  <ui-button type="button" variant="outline" (click)="reload()">
                    Reload translations
                  </ui-button>
                </div>
              }
              @if (canWrite()) {
                <div
                  class="border-border mt-6 flex flex-wrap items-center gap-3 border-t pt-4"
                >
                  <app-rename-key-panel
                    [projectSlug]="project.slug"
                    [entry]="entry"
                    [catalogs]="catalogs()"
                    [disabled]="keyDirty()"
                    (renamed)="onRenamed($event)"
                  />
                  <app-delete-key-panel
                    [projectSlug]="project.slug"
                    [entry]="entry"
                    [catalogs]="catalogs()"
                    [disabled]="keyDirty()"
                    (deleted)="onDeleted()"
                  />
                  @if (keyDirty()) {
                    <span class="text-muted-foreground text-xs">
                      Save or discard your changes to rename or delete this key.
                    </span>
                  }
                </div>
              }
            } @else {
              <p class="text-muted-foreground text-sm">
                Select a translation key to see it in every language.
              </p>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class TranslationWorkspace implements OnInit {
  readonly projectSlug = input.required<string>();
  readonly canWrite = input(false);
  /**
   * A key the Analysis mode asked to jump to (e.g. a missing key a human clicked). Wrapped with a
   * `token` rather than just a key string so the same key can be requested twice in a row and
   * still re-select it — two writes of an identical primitive would not re-trigger the effect
   * below.
   */
  readonly focusRequest = input<{ key: string; token: number } | null>(null);

  private readonly http = inject(HttpClient);
  private appliedFocusToken: number | null = null;

  protected readonly filters = FILTERS;

  protected readonly project = signal<TranslationWorkspaceProject | null>(null);
  protected readonly entries = signal<TranslationEntry[]>([]);
  protected readonly catalogs = signal<Record<string, TranslationCatalogState>>(
    {},
  );
  protected readonly targetOnlyKeys = signal<Record<string, number>>({});

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');

  protected readonly search = signal('');
  protected readonly filter = signal<TranslationFilter>('all');
  protected readonly selectedKey = signal<string | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly justSaved = signal(false);
  protected readonly conflicted = signal(false);

  /** Unsaved value edits on the selected key disable Rename/Delete rather than risk discarding them. */
  protected readonly keyDirty = signal(false);

  /** Derived locally so every count stays correct after a save or a create, with no re-fetch. */
  protected readonly summary = computed(() => {
    const entries = this.entries();
    const completeKeys = entries.filter((entry) => entry.complete).length;

    return {
      totalKeys: entries.length,
      completeKeys,
      missingKeys: entries.length - completeKeys,
    };
  });

  protected readonly visibleEntries = computed(() => {
    const filter = this.filter();
    const term = this.search().trim().toLowerCase();

    return this.entries().filter((entry) => {
      if (filter === 'missing' && entry.complete) {
        return false;
      }

      if (filter === 'complete' && !entry.complete) {
        return false;
      }

      return (
        !term ||
        entry.key.toLowerCase().includes(term) ||
        entry.sourceValue.toLowerCase().includes(term)
      );
    });
  });

  /** Grouped by the first dot-path segment, in the catalog's own key order. */
  protected readonly groups = computed<KeyGroup[]>(() => {
    const groups = new Map<string, TranslationEntry[]>();

    for (const entry of this.visibleEntries()) {
      const separator = entry.key.indexOf('.');
      const id = separator > 0 ? entry.key.slice(0, separator) : '';
      const existing = groups.get(id);

      if (existing) {
        existing.push(entry);
      } else {
        groups.set(id, [entry]);
      }
    }

    return [...groups].map(([id, entries]) => ({
      id,
      label: id || 'Top level',
      entries,
    }));
  });

  protected readonly selectedEntry = computed(() => {
    const key = this.selectedKey();
    return key
      ? (this.entries().find((entry) => entry.key === key) ?? null)
      : null;
  });

  protected readonly targetOnlyNotes = computed(() =>
    Object.entries(this.targetOnlyKeys()).map(
      ([locale, count]) =>
        `${locale} has ${count} ${count === 1 ? 'key' : 'keys'} not present in the source locale`,
    ),
  );

  constructor() {
    effect(() => {
      const request = this.focusRequest();

      if (
        !request ||
        request.token === this.appliedFocusToken ||
        !this.entries().some((entry) => entry.key === request.key)
      ) {
        return;
      }

      this.appliedFocusToken = request.token;
      this.select(request.key);
    });
  }

  /** Not the constructor: `projectSlug` is a required input and is only readable from here on. */
  ngOnInit(): void {
    void this.load();
  }

  protected filterClass(value: TranslationFilter): string {
    return cn(
      FILTER_BASE,
      this.filter() === value
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-muted',
    );
  }

  protected select(key: string): void {
    this.selectedKey.set(key);
    this.saveError.set('');
    this.justSaved.set(false);
    this.conflicted.set(false);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    await this.load();
  }

  protected async save(changes: TranslationFieldChange[]): Promise<void> {
    const entry = this.selectedEntry();

    if (!entry || !this.canWrite() || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.saveError.set('');
    this.justSaved.set(false);
    this.conflicted.set(false);

    try {
      const response = await firstValueFrom(
        this.http.patch<TranslationWriteResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations`,
          {
            key: entry.key,
            changes: changes.map((change) => ({
              ...change,
              ...(this.catalogs()[change.locale]?.revision
                ? {
                    expectedRevision: this.catalogs()[change.locale]?.revision,
                  }
                : {}),
            })),
          },
        ),
      );

      this.applyWrite(response);
      this.justSaved.set(true);
      setTimeout(() => this.justSaved.set(false), 2000);
    } catch (error) {
      this.reportSaveFailure(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected onCreated(response: TranslationWriteResponse): void {
    if (!response.entry) {
      return;
    }

    const entry = response.entry;
    this.catalogs.set(response.catalogs);
    this.entries.update((entries) => [
      ...entries.filter((candidate) => candidate.key !== entry.key),
      entry,
    ]);
    this.select(entry.key);
    this.justSaved.set(true);
    setTimeout(() => this.justSaved.set(false), 2000);
  }

  /**
   * Reloads the whole workspace rather than patching local state — a rename/delete already
   * confirmed the write server-side, and re-fetching is the simplest way to get every locale's
   * fresh revision without duplicating the read logic `load()` already has. `load()` does not
   * touch `loading`, so this stays a quiet refresh rather than a full skeleton flash.
   */
  protected async onRenamed(newKey: string): Promise<void> {
    await this.load();
    this.select(newKey);
  }

  /** `load()` already falls back to the first remaining key (or none) when the selection is gone. */
  protected async onDeleted(): Promise<void> {
    await this.load();
  }

  private applyWrite(response: TranslationWriteResponse): void {
    this.catalogs.set(response.catalogs);

    const entry = response.entry;

    if (entry) {
      this.entries.update((entries) =>
        entries.map((candidate) =>
          candidate.key === entry.key ? entry : candidate,
        ),
      );
    }
  }

  /**
   * A failed save deliberately leaves the locally held revisions untouched: adopting the server's
   * newer ones would let the next click overwrite exactly the edit that caused the conflict. The
   * human reloads instead, which is what the message asks for.
   */
  private reportSaveFailure(error: unknown): void {
    if (!(error instanceof HttpErrorResponse)) {
      this.saveError.set('Translation could not be saved.');
      return;
    }

    const results = error.error?.results;

    if (error.status === 409 && Array.isArray(results)) {
      const response = error.error as TranslationWriteResponse;
      const failed = response.results.filter(
        (result) => result.status === 'failed',
      );
      const conflicted = failed.some(
        (result) =>
          result.status === 'failed' &&
          result.error.code === 'CATALOG_REVISION_CONFLICT',
      );

      this.conflicted.set(conflicted);
      this.saveError.set(
        conflicted
          ? this.describeConflict(response)
          : failed
              .map((result) =>
                result.status === 'failed' ? result.error.message : '',
              )
              .join(' '),
      );
      return;
    }

    if (error.status === 403) {
      this.saveError.set('Your role cannot change translations.');
      return;
    }

    const message = error.error?.error?.message;
    this.saveError.set(
      typeof message === 'string' ? message : 'Translation could not be saved.',
    );
  }

  private describeConflict(response: TranslationWriteResponse): string {
    const saved = response.results
      .filter((result) => result.status === 'saved')
      .map((result) => result.locale);
    const conflict =
      'This translation changed after you opened it. Reload the latest version before saving again.';

    return saved.length > 0
      ? `Saved ${saved.join(', ')}. ${conflict}`
      : conflict;
  }

  private async load(): Promise<void> {
    this.loadError.set('');

    try {
      const response = await firstValueFrom(
        this.http.get<TranslationWorkspaceResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations`,
        ),
      );
      const workspace = response.workspace;

      this.project.set(workspace.project);
      this.entries.set(workspace.entries);
      this.catalogs.set(workspace.catalogs);
      this.targetOnlyKeys.set(workspace.diagnostics.targetOnlyKeys);
      this.saveError.set('');
      this.conflicted.set(false);

      const selected = this.selectedKey();
      const stillExists =
        selected !== null &&
        workspace.entries.some((entry) => entry.key === selected);

      if (!stillExists) {
        this.selectedKey.set(workspace.entries[0]?.key ?? null);
      }
    } catch {
      this.loadError.set('Translations could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}
