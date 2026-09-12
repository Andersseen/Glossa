import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LmnArrowUpTrayIcon } from 'lumen-icons/arrow-up-tray';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';

import { UiBadge } from '../../../ui/badge';
import { UiButton } from '../../../ui/button';
import {
  UiDrawer,
  UiDrawerClose,
  UiDrawerContent,
  UiDrawerOverlay,
  UiDrawerTitle,
} from '../../../ui/drawer';
import { UiError, UiFormField, UiLabel } from '../../../ui/form-field';
import { UiNativeSelect } from '../../../ui/select';
import { inferLocaleFromFileName } from './locale-inference';

export type CatalogImportProject = {
  sourceLocale: string;
  locales: string[];
};

type ImportFileState = {
  id: string;
  fileName: string;
  content: unknown;
  parseError: string | null;
  locale: string;
};

type PreviewRow = PreviewRowNew | PreviewRowExisting | PreviewRowError;

type PreviewRowNew = {
  id: string;
  fileName: string;
  locale: string;
  ok: true;
  status: 'new';
  messageCount: number;
};

type PreviewRowExisting = {
  id: string;
  fileName: string;
  locale: string;
  ok: true;
  status: 'existing';
  messageCount: number;
  existingMessageCount: number;
  existingRevision: string;
};

type PreviewRowError = {
  id: string;
  fileName: string;
  locale: string;
  ok: false;
  errorMessage: string;
};

type ImportPreviewApiResult =
  | { locale: string; ok: true; status: 'new'; messageCount: number }
  | {
      locale: string;
      ok: true;
      status: 'existing';
      messageCount: number;
      existingMessageCount: number;
      existingRevision: string;
    }
  | { locale: string; ok: false; error: { code: string; message: string } };

type ImportPreviewApiResponse = {
  results: ImportPreviewApiResult[];
  canImport: boolean;
};

type ImportCommitApiResult =
  | {
      locale: string;
      status: 'imported';
      revision: string;
      messageCount: number;
    }
  | {
      locale: string;
      status: 'failed';
      error: { code: string; message: string };
    };

type ImportCommitApiResponse = {
  results: ImportCommitApiResult[];
  imported: boolean;
};

type Stage = 'select' | 'preview' | 'result';

@Component({
  selector: 'app-catalog-import-panel',
  imports: [
    UiBadge,
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
    UiFormField,
    UiLabel,
    UiNativeSelect,
    LmnArrowUpTrayIcon,
    LmnXMarkIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [uiDrawer]="importDrawer"
      (click)="openImportDrawer()"
      class="border-input hover:bg-muted focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <lmn-arrow-up-tray aria-hidden="true" [size]="16" />
      Import catalogs
    </button>

    <ng-template #importDrawer>
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        class="flex w-[440px] max-w-[92vw] flex-col p-5"
      >
        <div class="flex items-start justify-between gap-4">
          <h2 uiDrawerTitle>Import catalogs</h2>
          <ui-drawer-close (click)="resetState()">
            <lmn-x-mark aria-hidden="true" [size]="16" />
          </ui-drawer-close>
        </div>

        @if (stage() === 'result' && commitResult(); as result) {
          <div class="mt-6 flex flex-1 flex-col gap-4" aria-live="polite">
            <p class="text-sm font-medium">
              {{ importedCount(result) }}
              {{ importedCount(result) === 1 ? 'catalog' : 'catalogs' }}
              imported
            </p>
            <ul
              class="border-border divide-y overflow-hidden rounded-lg border text-sm"
            >
              @for (row of result.results; track row.locale) {
                <li class="flex items-center justify-between gap-3 px-3 py-2">
                  <span class="font-medium">{{ row.locale }}.json</span>
                  @if (row.status === 'imported') {
                    <span class="text-muted-foreground text-xs">
                      {{ row.messageCount }} messages
                    </span>
                  } @else {
                    <span class="text-destructive text-xs">{{
                      row.error.message
                    }}</span>
                  }
                </li>
              }
            </ul>
            <p class="text-muted-foreground text-xs">
              Next: open <strong>Delivery</strong> to enable public delivery, or
              <strong>Access tokens</strong> to create a token for agents/CI.
            </p>
          </div>
        } @else {
          <div class="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto">
            <p class="text-muted-foreground text-sm">
              Import existing locale JSON files for this project's configured
              locales ({{ project().locales.join(', ') }}). Nested structure and
              MessageFormat syntax are preserved exactly.
            </p>

            <div
              class="border-border rounded-lg border border-dashed p-6 text-center transition-colors"
              [class.border-primary]="dragOver()"
              [class.bg-muted]="dragOver()"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave()"
              (drop)="onDrop($event)"
            >
              <p class="text-muted-foreground text-sm">
                Drag and drop JSON files here, or
              </p>
              <ui-button
                type="button"
                variant="outline"
                class="mt-3"
                (click)="fileInput.click()"
              >
                Choose files
              </ui-button>
              <input
                #fileInput
                type="file"
                accept=".json,application/json"
                multiple
                hidden
                aria-label="Choose catalog JSON files"
                (change)="onFileInputChange($event)"
              />
            </div>

            @if (files().length > 0) {
              <ul
                class="border-border divide-y overflow-hidden rounded-lg border text-sm"
              >
                @for (file of files(); track file.id) {
                  <li class="flex flex-col gap-2 px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="min-w-0 truncate font-medium">
                        {{ file.fileName }}
                      </span>
                      <button
                        type="button"
                        class="text-muted-foreground hover:text-destructive focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
                        [attr.aria-label]="'Remove ' + file.fileName"
                        (click)="removeFile(file.id)"
                      >
                        <lmn-x-mark aria-hidden="true" [size]="14" />
                      </button>
                    </div>

                    @if (file.parseError) {
                      <ui-error>{{ file.parseError }}</ui-error>
                    } @else {
                      <ui-form-field>
                        <ui-label
                          [htmlFor]="'catalog-import-locale-' + file.id"
                          [error]="!file.locale"
                        >
                          Locale
                        </ui-label>
                        <select
                          [id]="'catalog-import-locale-' + file.id"
                          uiNativeSelect
                          [value]="file.locale"
                          [attr.aria-describedby]="
                            !file.locale
                              ? 'catalog-import-locale-error-' + file.id
                              : null
                          "
                          [attr.aria-invalid]="!file.locale ? 'true' : null"
                          (change)="
                            setLocale(file.id, $any($event.target).value)
                          "
                        >
                          <option value="">Select a locale</option>
                          @for (
                            locale of availableLocalesForFile(file.id);
                            track locale
                          ) {
                            <option [value]="locale">{{ locale }}</option>
                          }
                        </select>
                      </ui-form-field>
                      @if (!file.locale) {
                        <ui-error
                          [id]="'catalog-import-locale-error-' + file.id"
                        >
                          Choose one of this project's configured locales for
                          this file.
                        </ui-error>
                      }
                    }
                  </li>
                }
              </ul>
            }

            @if (previewError()) {
              <ui-error>{{ previewError() }}</ui-error>
            }

            @if (stage() === 'select') {
              <ui-button
                type="button"
                [disabled]="!allFilesReady() || previewing()"
                (click)="preview()"
              >
                {{ previewing() ? 'Checking...' : 'Preview import' }}
              </ui-button>
            }

            @if (stage() === 'preview') {
              <section class="grid gap-3">
                <h3 class="text-sm font-semibold">Preview</h3>
                <div class="border-border overflow-x-auto rounded-lg border">
                  <table class="w-full min-w-[360px] text-left text-sm">
                    <thead>
                      <tr
                        class="border-border text-muted-foreground border-b text-xs uppercase"
                      >
                        <th scope="col" class="px-3 py-2 font-medium">File</th>
                        <th scope="col" class="px-3 py-2 font-medium">
                          Locale
                        </th>
                        <th scope="col" class="px-3 py-2 font-medium">Keys</th>
                        <th scope="col" class="px-3 py-2 font-medium">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of previewRows(); track row.id) {
                        <tr
                          class="border-border last:border-b-0 [&:not(:last-child)]:border-b"
                        >
                          <td class="max-w-[10rem] truncate px-3 py-2">
                            {{ row.fileName }}
                          </td>
                          <td class="px-3 py-2">{{ row.locale }}</td>
                          <td class="px-3 py-2">
                            {{ row.ok ? row.messageCount : '—' }}
                          </td>
                          <td class="px-3 py-2">
                            @if (!row.ok) {
                              <ui-badge variant="destructive">
                                {{ row.errorMessage }}
                              </ui-badge>
                            } @else if (row.status === 'existing') {
                              <ui-badge variant="secondary">
                                Replace existing
                              </ui-badge>
                            } @else {
                              <ui-badge variant="outline">New</ui-badge>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>

                @for (row of existingRows(); track row.id) {
                  <label class="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="border-input mt-0.5 size-4 rounded"
                      [checked]="replaceConfirmed()[row.locale] ?? false"
                      (change)="
                        setReplaceConfirmed(
                          row.locale,
                          $any($event.target).checked
                        )
                      "
                    />
                    <span>
                      Replace the existing
                      <code>{{ row.locale }}.json</code> catalog ({{
                        row.existingMessageCount
                      }}
                      messages currently stored).
                    </span>
                  </label>
                }

                @if (commitError()) {
                  <ui-error>{{ commitError() }}</ui-error>
                }

                <div class="flex justify-end gap-3">
                  <ui-button
                    type="button"
                    variant="outline"
                    [disabled]="importing()"
                    (click)="backToSelect()"
                  >
                    Back
                  </ui-button>
                  <ui-button
                    type="button"
                    [disabled]="!canCommit() || importing()"
                    (click)="commit()"
                  >
                    {{ importing() ? 'Importing...' : 'Import' }}
                  </ui-button>
                </div>
              </section>
            }
          </div>
        }
      </section>
    </ng-template>
  `,
})
export class CatalogImportPanel {
  readonly projectSlug = input.required<string>();
  readonly project = input.required<CatalogImportProject>();
  readonly imported = output<void>();

  private readonly http = inject(HttpClient);

  protected readonly files = signal<ImportFileState[]>([]);
  protected readonly stage = signal<Stage>('select');
  protected readonly dragOver = signal(false);

  protected readonly previewing = signal(false);
  protected readonly previewError = signal('');
  protected readonly previewRows = signal<PreviewRow[]>([]);
  protected readonly replaceConfirmed = signal<Record<string, boolean>>({});

  protected readonly importing = signal(false);
  protected readonly commitError = signal('');
  protected readonly commitResult = signal<ImportCommitApiResponse | null>(
    null,
  );

  protected readonly allFilesReady = computed(() => {
    const files = this.files();
    return (
      files.length > 0 && files.every((file) => !file.parseError && file.locale)
    );
  });

  protected readonly existingRows = computed(() =>
    this.previewRows().filter(
      (row): row is PreviewRowExisting => row.ok && row.status === 'existing',
    ),
  );

  protected readonly canCommit = computed(() => {
    const rows = this.previewRows();

    if (rows.length === 0 || !rows.every((row) => row.ok)) {
      return false;
    }

    const confirmed = this.replaceConfirmed();

    return rows.every(
      (row) =>
        !(row.ok && row.status === 'existing') ||
        confirmed[row.locale] === true,
    );
  });

  protected openImportDrawer(): void {
    this.resetState();
  }

  protected resetState(): void {
    this.files.set([]);
    this.stage.set('select');
    this.dragOver.set(false);
    this.previewing.set(false);
    this.previewError.set('');
    this.previewRows.set([]);
    this.replaceConfirmed.set({});
    this.importing.set(false);
    this.commitError.set('');
    this.commitResult.set(null);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    const dropped = event.dataTransfer?.files;

    if (dropped && dropped.length > 0) {
      void this.addFiles(dropped);
    }
  }

  protected onFileInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;

    if (target.files && target.files.length > 0) {
      void this.addFiles(target.files);
    }

    target.value = '';
  }

  protected availableLocalesForFile(fileId: string): string[] {
    const usedByOthers = new Set(
      this.files()
        .filter((file) => file.id !== fileId && file.locale)
        .map((file) => file.locale),
    );

    return this.project().locales.filter((locale) => !usedByOthers.has(locale));
  }

  protected setLocale(fileId: string, locale: string): void {
    this.files.update((files) =>
      files.map((file) => (file.id === fileId ? { ...file, locale } : file)),
    );
    this.invalidatePreview();
  }

  protected removeFile(fileId: string): void {
    this.files.update((files) => files.filter((file) => file.id !== fileId));
    this.invalidatePreview();
  }

  protected backToSelect(): void {
    this.stage.set('select');
    this.previewRows.set([]);
    this.commitError.set('');
  }

  protected setReplaceConfirmed(locale: string, checked: boolean): void {
    this.replaceConfirmed.update((current) => ({
      ...current,
      [locale]: checked,
    }));
  }

  protected async preview(): Promise<void> {
    if (!this.allFilesReady()) {
      return;
    }

    this.previewing.set(true);
    this.previewError.set('');

    try {
      const files = this.files();
      const response = await firstValueFrom(
        this.http.post<ImportPreviewApiResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/catalogs/import/preview`,
          {
            catalogs: files.map((file) => ({
              locale: file.locale,
              content: file.content,
            })),
          },
        ),
      );

      const rows: PreviewRow[] = response.results.map((result, index) => {
        const file = files[index];
        const id = file?.id ?? `row-${index}`;
        const fileName = file?.fileName ?? result.locale;

        if (!result.ok) {
          return {
            id,
            fileName,
            locale: result.locale,
            ok: false,
            errorMessage: result.error.message,
          };
        }

        return result.status === 'existing'
          ? {
              id,
              fileName,
              locale: result.locale,
              ok: true,
              status: 'existing',
              messageCount: result.messageCount,
              existingMessageCount: result.existingMessageCount,
              existingRevision: result.existingRevision,
            }
          : {
              id,
              fileName,
              locale: result.locale,
              ok: true,
              status: 'new',
              messageCount: result.messageCount,
            };
      });

      this.previewRows.set(rows);

      const confirmations: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.ok && row.status === 'existing') {
          confirmations[row.locale] = false;
        }
      }
      this.replaceConfirmed.set(confirmations);
      this.commitError.set('');
      this.stage.set('preview');
    } catch (error) {
      this.previewError.set(
        readImportError(error, 'Catalogs could not be previewed.'),
      );
    } finally {
      this.previewing.set(false);
    }
  }

  protected async commit(): Promise<void> {
    if (!this.canCommit()) {
      return;
    }

    this.importing.set(true);
    this.commitError.set('');

    try {
      const files = this.files();
      const rows = this.previewRows();

      const response = await firstValueFrom(
        this.http.post<ImportCommitApiResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/catalogs/import`,
          {
            catalogs: files.map((file, index) => {
              const row = rows[index];

              if (row?.ok && row.status === 'existing') {
                return {
                  locale: file.locale,
                  content: file.content,
                  replaceExisting: true,
                  expectedRevision: row.existingRevision,
                };
              }

              return { locale: file.locale, content: file.content };
            }),
          },
        ),
      );

      this.commitResult.set(response);
      this.stage.set('result');
      this.imported.emit();
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 422 &&
        error.error?.results
      ) {
        this.commitError.set(
          summarizeCommitFailure(error.error as ImportCommitApiResponse),
        );
      } else {
        this.commitError.set(
          readImportError(error, 'Catalogs could not be imported.'),
        );
      }
    } finally {
      this.importing.set(false);
    }
  }

  protected importedCount(result: ImportCommitApiResponse): number {
    return result.results.filter((row) => row.status === 'imported').length;
  }

  private invalidatePreview(): void {
    if (this.stage() !== 'select') {
      this.stage.set('select');
      this.previewRows.set([]);
      this.commitError.set('');
    }
  }

  private async addFiles(fileList: FileList): Promise<void> {
    const incoming = Array.from(fileList).filter((file) =>
      file.name.toLowerCase().endsWith('.json'),
    );
    const usedLocales = new Set(
      this.files()
        .map((file) => file.locale)
        .filter(Boolean),
    );
    const configuredLocales = this.project().locales;

    const added: ImportFileState[] = [];

    for (const file of incoming) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let parseError: string | null = null;
      let content: unknown;

      try {
        const rawText = await file.text();

        try {
          content = JSON.parse(rawText);
        } catch {
          parseError = 'Invalid JSON.';
        }
      } catch {
        parseError = 'File could not be read.';
      }

      if (
        !parseError &&
        (typeof content !== 'object' ||
          content === null ||
          Array.isArray(content))
      ) {
        parseError = 'Catalog root must be an object.';
      }

      let locale = '';

      if (!parseError) {
        const inferred = inferLocaleFromFileName(file.name);

        if (
          inferred &&
          configuredLocales.includes(inferred) &&
          !usedLocales.has(inferred)
        ) {
          locale = inferred;
          usedLocales.add(inferred);
        }
      }

      added.push({ id, fileName: file.name, content, parseError, locale });
    }

    if (added.length === 0) {
      return;
    }

    this.files.update((files) => [...files, ...added]);
    this.invalidatePreview();
  }
}

function summarizeCommitFailure(body: ImportCommitApiResponse): string {
  const failed = body.results.filter(
    (row) =>
      row.status === 'failed' &&
      row.error.code !== 'CATALOG_IMPORT_NOT_ATTEMPTED',
  );

  if (failed.length === 0) {
    return 'Import could not be completed. Re-run preview and try again.';
  }

  return failed
    .filter(
      (row): row is Extract<ImportCommitApiResult, { status: 'failed' }> =>
        row.status === 'failed',
    )
    .map((row) => `${row.locale}: ${row.error.message}`)
    .join(' ');
}

function readImportError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
