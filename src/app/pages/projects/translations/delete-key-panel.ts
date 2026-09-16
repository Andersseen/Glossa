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

import { UiButton } from '../../../ui/button';
import { buttonVariants } from '../../../ui/button/variants';
import {
  UiDrawer,
  UiDrawerClose,
  UiDrawerContent,
  UiDrawerDescription,
  UiDrawerOverlay,
  UiDrawerTitle,
} from '../../../ui/drawer';
import { UiError } from '../../../ui/form-field';
import { localeDisplayName } from './locale-label';
import type {
  TranslationCatalogState,
  TranslationEntry,
} from './translation-workspace.types';

/** Self-contained like `RenameKeyPanel` — owns its own drawer, request, and error state. */
@Component({
  selector: 'app-delete-key-panel',
  imports: [
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerDescription,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [uiDrawer]="deleteDrawer"
      [disabled]="disabled()"
      (click)="resetState()"
      class="border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
    >
      Delete key
    </button>

    <ng-template #deleteDrawer let-close="close">
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        class="flex w-[440px] max-w-[92vw] flex-col p-5"
      >
        <h2 uiDrawerTitle>Delete translation key?</h2>
        <p uiDrawerDescription class="mt-2">
          This removes this key and its stored translations from every locale.
          This cannot be undone. Applications still using this key may show a
          missing translation.
        </p>

        <div class="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
          <p class="font-mono text-sm font-semibold break-all">
            {{ entry().key }}
          </p>

          @if (translatedValues().length > 0) {
            <dl class="grid gap-3">
              @for (value of translatedValues(); track value.locale) {
                <div>
                  <dt class="text-muted-foreground text-xs font-medium">
                    {{ value.label }}
                  </dt>
                  <dd class="text-sm break-words">{{ value.value }}</dd>
                </div>
              }
            </dl>
          }

          @if (error()) {
            <ui-error>{{ error() }}</ui-error>
          }

          <div class="flex justify-end gap-3">
            <ui-drawer-close
              srLabel=""
              [class]="cancelButtonClass"
              (click)="resetState()"
            >
              Cancel
            </ui-drawer-close>
            <ui-button
              type="button"
              variant="destructive"
              [disabled]="submitting()"
              (click)="submit(close)"
            >
              {{ submitting() ? 'Deleting...' : 'Delete translation' }}
            </ui-button>
          </div>
        </div>
      </section>
    </ng-template>
  `,
})
export class DeleteKeyPanel {
  readonly projectSlug = input.required<string>();
  readonly entry = input.required<TranslationEntry>();
  readonly catalogs = input.required<Record<string, TranslationCatalogState>>();
  readonly disabled = input(false);

  readonly deleted = output<void>();

  private readonly http = inject(HttpClient);

  protected readonly cancelButtonClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly error = signal('');
  protected readonly submitting = signal(false);

  protected readonly translatedValues = computed(() =>
    Object.entries(this.entry().values)
      .filter(([, value]) => value.exists)
      .map(([locale, value]) => ({
        locale,
        label: localeDisplayName(locale),
        value: value.value ?? '',
      })),
  );

  protected resetState(): void {
    this.error.set('');
    this.submitting.set(false);
  }

  protected async submit(close: () => void): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    try {
      await firstValueFrom(
        this.http.post(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations/delete`,
          {
            key: this.entry().key,
            expectedRevisions: this.expectedRevisions(),
          },
        ),
      );

      this.deleted.emit();
      close();
    } catch (error) {
      this.reportFailure(error);
    } finally {
      this.submitting.set(false);
    }
  }

  private expectedRevisions(): Record<string, string> {
    const revisions: Record<string, string> = {};

    for (const [locale, state] of Object.entries(this.catalogs())) {
      if (state.revision) {
        revisions[locale] = state.revision;
      }
    }

    return revisions;
  }

  private reportFailure(error: unknown): void {
    if (!(error instanceof HttpErrorResponse)) {
      this.error.set('The key could not be deleted.');
      return;
    }

    const code = error.error?.error?.code;
    const message = error.error?.error?.message;

    if (code === 'CATALOG_REVISION_CONFLICT') {
      this.error.set(
        'Translations changed after you opened this workspace. Reload before deleting.',
      );
      return;
    }

    this.error.set(
      typeof message === 'string' ? message : 'The key could not be deleted.',
    );
  }
}
