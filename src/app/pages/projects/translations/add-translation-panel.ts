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
import { LmnPlusIcon } from 'lumen-icons/plus';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';
import { firstValueFrom } from 'rxjs';

import { UiBadge } from '../../../ui/badge';
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
import { UiTextarea } from '../../../ui/textarea';
import { localeDisplayName } from './locale-label';
import type {
  TranslationCatalogState,
  TranslationWriteResponse,
} from './translation-workspace.types';

@Component({
  selector: 'app-add-translation-panel',
  imports: [
    LmnPlusIcon,
    LmnXMarkIcon,
    UiBadge,
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
    UiTextarea,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [uiDrawer]="addTranslationDrawer"
      (click)="resetState()"
      class="border-input hover:bg-muted focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2"
    >
      <lmn-plus aria-hidden="true" [size]="16" />
      Add translation
    </button>

    <!-- close comes from the dialog template context ng-primitives passes in, so a
         successful create dismisses the drawer without reaching for the dialog ref. -->
    <ng-template #addTranslationDrawer let-close="close">
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        class="flex w-[440px] max-w-[92vw] flex-col p-5"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 uiDrawerTitle>Add translation</h2>
            <p uiDrawerDescription class="mt-2">
              Creates the key in the source locale and any language you fill in.
            </p>
          </div>
          <ui-drawer-close (click)="resetState()">
            <lmn-x-mark aria-hidden="true" [size]="16" />
          </ui-drawer-close>
        </div>

        <div class="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto">
          <ui-form-field>
            <ui-label htmlFor="add-translation-key" [error]="!!keyError()">
              Key
            </ui-label>
            <ui-input
              id="add-translation-key"
              [value]="key()"
              (valueChange)="setKey($event)"
              placeholder="checkout.payment.title"
              [ariaDescribedBy]="
                keyError()
                  ? 'add-translation-key-error'
                  : 'add-translation-key-hint'
              "
            />
            @if (keyError()) {
              <ui-error id="add-translation-key-error">{{
                keyError()
              }}</ui-error>
            } @else {
              <ui-hint id="add-translation-key-hint">
                Dot-separated, like <code>nav.home</code>.
              </ui-hint>
            }
          </ui-form-field>

          @for (field of fields(); track field.locale) {
            <ui-form-field>
              <ui-label [htmlFor]="field.inputId">
                <span class="flex flex-wrap items-center gap-2">
                  {{ field.label }}
                  <span class="text-muted-foreground font-mono text-xs">
                    {{ field.locale }}
                  </span>
                  @if (field.isSource) {
                    <ui-badge variant="outline">Source · required</ui-badge>
                  }
                </span>
              </ui-label>
              <ui-textarea
                [id]="field.inputId"
                [value]="field.value"
                (valueChange)="setValue(field.locale, $event)"
                [rows]="2"
                spellcheck="false"
              />
            </ui-form-field>
          }

          @if (submitError()) {
            <ui-error>{{ submitError() }}</ui-error>
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
              [disabled]="!canSubmit() || submitting()"
              (click)="submit(close)"
            >
              {{ submitting() ? 'Adding...' : 'Add translation' }}
            </ui-button>
          </div>
        </div>
      </section>
    </ng-template>
  `,
})
export class AddTranslationPanel {
  readonly projectSlug = input.required<string>();
  readonly sourceLocale = input.required<string>();
  readonly locales = input.required<readonly string[]>();
  readonly catalogs = input.required<Record<string, TranslationCatalogState>>();

  readonly created = output<TranslationWriteResponse>();

  private readonly http = inject(HttpClient);

  protected readonly cancelButtonClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly key = signal('');
  protected readonly values = signal<Record<string, string>>({});
  protected readonly keyError = signal('');
  protected readonly submitError = signal('');
  protected readonly submitting = signal(false);

  protected readonly fields = computed(() =>
    this.orderedLocales().map((locale) => ({
      locale,
      label: localeDisplayName(locale),
      isSource: locale === this.sourceLocale(),
      value: this.values()[locale] ?? '',
      inputId: `add-translation-${locale}`,
    })),
  );

  protected readonly canSubmit = computed(
    () =>
      !!this.key().trim() &&
      !!(this.values()[this.sourceLocale()] ?? '').trim(),
  );

  protected resetState(): void {
    this.key.set('');
    this.values.set({});
    this.keyError.set('');
    this.submitError.set('');
    this.submitting.set(false);
  }

  protected setKey(value: string): void {
    this.key.set(value);
    this.keyError.set('');
    this.submitError.set('');
  }

  protected setValue(locale: string, value: string): void {
    this.values.update((values) => ({ ...values, [locale]: value }));
    this.submitError.set('');
  }

  protected async submit(close: () => void): Promise<void> {
    if (!this.canSubmit() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.keyError.set('');
    this.submitError.set('');

    try {
      const response = await firstValueFrom(
        this.http.post<TranslationWriteResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations`,
          {
            key: this.key().trim(),
            values: this.values(),
            expectedRevisions: this.expectedRevisions(),
          },
        ),
      );

      this.created.emit(response);
      this.resetState();
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
      this.submitError.set('Translation could not be added.');
      return;
    }

    const code = error.error?.error?.code;
    const message = error.error?.error?.message;

    if (
      code === 'TRANSLATION_KEY_EXISTS' ||
      code === 'INVALID_TRANSLATION_KEY'
    ) {
      this.keyError.set(
        typeof message === 'string' ? message : 'This key cannot be used.',
      );
      return;
    }

    if (error.status === 409 && Array.isArray(error.error?.results)) {
      this.submitError.set(
        'The catalogs changed after this workspace was opened. Reload the latest version and try again.',
      );
      return;
    }

    this.submitError.set(
      typeof message === 'string' ? message : 'Translation could not be added.',
    );
  }

  private readonly orderedLocales = computed(() => {
    const source = this.sourceLocale();
    const rest = this.locales().filter((locale) => locale !== source);
    return this.locales().includes(source) ? [source, ...rest] : rest;
  });
}
