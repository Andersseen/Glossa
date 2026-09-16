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
import { UiError, UiFormField, UiHint, UiLabel } from '../../../ui/form-field';
import { UiInput } from '../../../ui/input';
import type {
  TranslationCatalogState,
  TranslationEntry,
  TranslationLifecycleResponse,
} from './translation-workspace.types';

/**
 * Self-contained, like `AddTranslationPanel`: owns its own drawer, request, and error state, and
 * only tells the workspace the outcome (`renamed`) so the workspace can reload and reselect —
 * never every intermediate keystroke.
 */
@Component({
  selector: 'app-rename-key-panel',
  imports: [
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerDescription,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
    UiFormField,
    UiHint,
    UiInput,
    UiLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [uiDrawer]="renameDrawer"
      [disabled]="disabled()"
      (click)="resetState()"
      class="border-input hover:bg-muted focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
    >
      Rename key
    </button>

    <ng-template #renameDrawer let-close="close">
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        class="flex w-[440px] max-w-[92vw] flex-col p-5"
      >
        <h2 uiDrawerTitle>Rename translation key</h2>
        <p uiDrawerDescription class="mt-2">
          This changes the key across all existing locale catalogs. Applications
          using the old key may need to be updated.
        </p>

        <div class="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto">
          <div>
            <p class="text-muted-foreground text-xs font-medium">Current key</p>
            <p class="mt-1 font-mono text-sm font-semibold break-all">
              {{ entry().key }}
            </p>
          </div>

          <ui-form-field>
            <ui-label htmlFor="rename-key-new">New key</ui-label>
            <ui-input
              id="rename-key-new"
              [value]="newKey()"
              (valueChange)="setNewKey($event)"
              placeholder="navigation.home"
              [ariaDescribedBy]="
                error() ? 'rename-key-error' : 'rename-key-hint'
              "
            />
            @if (error()) {
              <ui-error id="rename-key-error">{{ error() }}</ui-error>
            } @else {
              <ui-hint id="rename-key-hint">
                Dot-separated, like <code>nav.home</code>.
              </ui-hint>
            }
          </ui-form-field>

          <p class="text-muted-foreground text-sm" aria-live="polite">
            @if (submitting()) {
              Renaming...
            }
          </p>

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
              [disabled]="!canSubmit() || submitting()"
              (click)="submit(close)"
            >
              {{ submitting() ? 'Renaming...' : 'Rename key' }}
            </ui-button>
          </div>
        </div>
      </section>
    </ng-template>
  `,
})
export class RenameKeyPanel {
  readonly projectSlug = input.required<string>();
  readonly entry = input.required<TranslationEntry>();
  readonly catalogs = input.required<Record<string, TranslationCatalogState>>();
  readonly disabled = input(false);

  readonly renamed = output<string>();

  private readonly http = inject(HttpClient);

  protected readonly cancelButtonClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly newKey = signal('');
  protected readonly error = signal('');
  protected readonly submitting = signal(false);

  protected readonly canSubmit = computed(() => {
    const value = this.newKey().trim();
    return !!value && value !== this.entry().key;
  });

  /** Pre-filled with the current key so renaming a segment is an edit, not a retype from scratch. */
  protected resetState(): void {
    this.newKey.set(this.entry().key);
    this.error.set('');
    this.submitting.set(false);
  }

  protected setNewKey(value: string): void {
    this.newKey.set(value);
    this.error.set('');
  }

  protected async submit(close: () => void): Promise<void> {
    if (!this.canSubmit() || this.submitting()) {
      return;
    }

    const newKey = this.newKey().trim();
    this.submitting.set(true);
    this.error.set('');

    try {
      const response = await firstValueFrom(
        this.http.post<TranslationLifecycleResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations/rename`,
          {
            key: this.entry().key,
            newKey,
            expectedRevisions: this.expectedRevisions(),
          },
        ),
      );

      this.renamed.emit(response.newKey ?? newKey);
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
      this.error.set('The key could not be renamed.');
      return;
    }

    const code = error.error?.error?.code;
    const message = error.error?.error?.message;

    if (code === 'CATALOG_REVISION_CONFLICT') {
      this.error.set(
        'Translations changed after you opened this workspace. Reload before renaming.',
      );
      return;
    }

    if (code === 'TRANSLATION_KEY_COLLISION') {
      this.error.set(
        typeof message === 'string'
          ? message
          : 'That key already exists. Choose another key.',
      );
      return;
    }

    this.error.set(
      typeof message === 'string' ? message : 'The key could not be renamed.',
    );
  }
}
