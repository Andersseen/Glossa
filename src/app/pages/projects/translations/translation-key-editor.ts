import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  linkedSignal,
  output,
} from '@angular/core';

import { UiBadge } from '../../../ui/badge';
import { UiButton } from '../../../ui/button';
import { UiError, UiFormField, UiLabel } from '../../../ui/form-field';
import { UiTextarea } from '../../../ui/textarea';
import { localeDisplayName } from './locale-label';
import type {
  TranslationEntry,
  TranslationFieldChange,
} from './translation-workspace.types';

type LocaleField = {
  locale: string;
  label: string;
  isSource: boolean;
  exists: boolean;
  original: string;
  value: string;
  dirty: boolean;
  inputId: string;
};

@Component({
  selector: 'app-translation-key-editor',
  imports: [UiBadge, UiButton, UiError, UiFormField, UiLabel, UiTextarea],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-6">
      <div>
        <p class="text-muted-foreground text-xs font-medium">Translation key</p>
        <h3 class="mt-1 font-mono text-base font-semibold break-all">
          {{ entry().key }}
        </h3>
        <p class="mt-2 flex flex-wrap items-center gap-2">
          @if (entry().complete) {
            <ui-badge variant="secondary">
              {{ entry().translatedCount }} / {{ entry().totalLocales }}
            </ui-badge>
          } @else {
            <ui-badge variant="outline">
              {{ entry().translatedCount }} / {{ entry().totalLocales }}
            </ui-badge>
            <ui-badge variant="destructive">Missing</ui-badge>
          }
        </p>
      </div>

      <div class="grid gap-5">
        @for (field of fields(); track field.locale) {
          <ui-form-field>
            <ui-label [htmlFor]="field.inputId">
              <span class="flex flex-wrap items-center gap-2">
                {{ field.label }}
                <span class="text-muted-foreground font-mono text-xs">
                  {{ field.locale }}
                </span>
                @if (field.isSource) {
                  <ui-badge variant="outline">Source</ui-badge>
                }
                @if (!field.exists) {
                  <ui-badge variant="secondary">Not translated</ui-badge>
                }
              </span>
            </ui-label>
            <ui-textarea
              [id]="field.inputId"
              [value]="field.value"
              (valueChange)="setDraft(field.locale, $event)"
              [rows]="3"
              [readonly]="!canWrite()"
              spellcheck="false"
            />
          </ui-form-field>
        }
      </div>

      @if (error()) {
        <ui-error>{{ error() }}</ui-error>
      }

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-muted-foreground text-sm" aria-live="polite">
          @if (saving()) {
            Saving...
          } @else if (saved()) {
            Saved
          } @else if (canWrite() && dirtyLocales().length > 0) {
            {{ dirtyLocales().length }} unsaved
            {{ dirtyLocales().length === 1 ? 'change' : 'changes' }}
          }
        </p>
        @if (canWrite()) {
          <ui-button
            type="button"
            [disabled]="saving() || dirtyLocales().length === 0"
            (click)="submit()"
          >
            {{ saving() ? 'Saving...' : 'Save' }}
          </ui-button>
        }
      </div>
    </div>
  `,
})
export class TranslationKeyEditor {
  readonly entry = input.required<TranslationEntry>();
  readonly sourceLocale = input.required<string>();
  readonly locales = input.required<readonly string[]>();
  readonly canWrite = input(false);
  readonly saving = input(false);
  readonly saved = input(false);
  readonly error = input('');

  readonly save = output<TranslationFieldChange[]>();
  /** Lets the workspace disable Rename/Delete while an edit is unsaved, without lifting draft state up. */
  readonly dirtyChange = output<boolean>();

  /**
   * Re-seeded whenever the selected key (or the entry the server just wrote back) changes, so
   * switching keys never carries another key's text along, and a successful save leaves the
   * fields matching what was actually stored.
   */
  private readonly drafts = linkedSignal(() => this.originalValues());

  constructor() {
    effect(() => this.dirtyChange.emit(this.dirtyLocales().length > 0));
  }

  protected readonly fields = computed<LocaleField[]>(() => {
    const originals = this.originalValues();
    const drafts = this.drafts();
    const entry = this.entry();
    const keyId = entry.key.replace(/[^a-zA-Z0-9]+/g, '-');

    return this.orderedLocales().map((locale) => {
      const original = originals[locale] ?? '';
      const value = drafts[locale] ?? '';

      return {
        locale,
        label: localeDisplayName(locale),
        isSource: locale === this.sourceLocale(),
        exists: entry.values[locale]?.exists ?? false,
        original,
        value,
        dirty: value !== original,
        inputId: `translation-${keyId}-${locale}`,
      };
    });
  });

  protected readonly dirtyLocales = computed(() =>
    this.fields()
      .filter((field) => field.dirty)
      .map((field) => field.locale),
  );

  protected setDraft(locale: string, value: string): void {
    this.drafts.update((drafts) => ({ ...drafts, [locale]: value }));
  }

  /** Only the locales the human actually touched are submitted — never the whole key. */
  protected submit(): void {
    const changes = this.fields()
      .filter((field) => field.dirty)
      .map((field) => ({ locale: field.locale, value: field.value }));

    if (changes.length > 0) {
      this.save.emit(changes);
    }
  }

  /** Source locale first — it is the value every other locale is translated from. */
  private readonly orderedLocales = computed(() => {
    const source = this.sourceLocale();
    const rest = this.locales().filter((locale) => locale !== source);
    return this.locales().includes(source) ? [source, ...rest] : rest;
  });

  private readonly originalValues = computed(() => {
    const entry = this.entry();
    const values: Record<string, string> = {};

    for (const locale of this.orderedLocales()) {
      values[locale] = entry.values[locale]?.value ?? '';
    }

    return values;
  });
}
