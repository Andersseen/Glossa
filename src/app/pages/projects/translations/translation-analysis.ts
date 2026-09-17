import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { UiBadge } from '../../../ui/badge';
import { UiButton } from '../../../ui/button';
import { UiError } from '../../../ui/form-field';
import { UiSkeleton } from '../../../ui/skeleton';
import { cn } from '../../../ui/utils';
import { localeDisplayName } from './locale-label';
import type {
  TranslationAnalysisResponse,
  TranslationLocaleAnalysis,
} from './translation-workspace.types';

type IssueTab = 'missing' | 'extra';

const ISSUE_TAB_BASE =
  'rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Read-only project-wide key-set diff, next to the Workspace inside the Translations tab (not a
 * second top-level product area). Values are never compared between locales — only key
 * presence — per translated string is deliberately not "different" from its source. Missing keys
 * jump back into the one Workspace editor rather than opening a second one here.
 */
@Component({
  selector: 'app-translation-analysis',
  imports: [RouterLink, UiBadge, UiButton, UiError, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="grid gap-4" aria-label="Loading translation analysis">
        <ui-skeleton width="18rem" height="1.25rem" />
        <ui-skeleton width="100%" height="12rem" />
      </div>
    } @else if (loadError()) {
      <div class="grid justify-items-start gap-3">
        <ui-error>{{ loadError() }}</ui-error>
        <ui-button type="button" variant="outline" (click)="reload()">
          Try again
        </ui-button>
      </div>
    } @else {
      <section class="grid gap-6">
        <dl class="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <dt class="text-muted-foreground text-xs font-medium">
              Source keys
            </dt>
            <dd class="text-lg font-semibold">{{ sourceKeys() }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs font-medium">Locales</dt>
            <dd class="text-lg font-semibold">{{ locales().length }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs font-medium">
              Complete across all locales
            </dt>
            <dd class="text-lg font-semibold">{{ completeKeys() }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-xs font-medium">
              Incomplete
            </dt>
            <dd class="text-lg font-semibold">{{ incompleteKeys() }}</dd>
          </div>
        </dl>

        @if (sourceKeys() === 0) {
          <p class="text-muted-foreground text-sm">
            No source catalog yet. Add translations in the Workspace tab to see
            coverage here.
          </p>
        } @else {
          <div class="border-border overflow-hidden rounded-lg border">
            <h3 class="sr-only">Translation health by locale</h3>
            <ul>
              @for (locale of locales(); track locale.locale) {
                <li>
                  <button
                    type="button"
                    (click)="selectLocale(locale.locale)"
                    [attr.aria-current]="
                      selectedLocale() === locale.locale ? 'true' : null
                    "
                    class="border-border hover:bg-muted focus-visible:ring-ring aria-[current]:bg-muted grid w-full gap-2 border-b px-4 py-3 text-left outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[minmax(9rem,14rem)_1fr_auto] sm:items-center sm:gap-4"
                  >
                    <span class="flex flex-wrap items-center gap-2 font-medium">
                      {{ localeName(locale.locale) }}
                      <span class="text-muted-foreground font-mono text-xs">
                        {{ locale.locale }}
                      </span>
                      @if (locale.isSource) {
                        <ui-badge variant="outline">Source</ui-badge>
                      } @else if (!locale.catalogExists) {
                        <ui-badge variant="secondary">Not created</ui-badge>
                      }
                    </span>

                    <span class="flex items-center gap-3">
                      <span
                        class="bg-muted relative h-2 flex-1 overflow-hidden rounded-full"
                        role="progressbar"
                        [attr.aria-valuenow]="coveragePercent(locale) ?? 0"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        [attr.aria-label]="
                          localeName(locale.locale) + ' translation coverage'
                        "
                      >
                        <span
                          class="bg-primary absolute inset-y-0 left-0 rounded-full"
                          [style.width.%]="coveragePercent(locale) ?? 0"
                        ></span>
                      </span>
                      <span
                        class="w-12 shrink-0 text-right text-sm font-medium tabular-nums"
                      >
                        {{
                          coveragePercent(locale) === null
                            ? '—'
                            : coveragePercent(locale) + '%'
                        }}
                      </span>
                    </span>

                    <span
                      class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:justify-end"
                    >
                      <span>
                        {{ locale.translatedKeys }} /
                        {{ locale.totalSourceKeys }}
                      </span>
                      <span>
                        <span class="sr-only">Missing: </span>
                        {{ locale.isSource ? 0 : locale.missingKeys.length }}
                        missing
                      </span>
                      <span>
                        <span class="sr-only">Extra: </span>
                        @if (locale.isSource) {
                          —
                        } @else {
                          {{ locale.extraKeys.length }} extra
                        }
                      </span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          </div>

          <div class="border-border rounded-lg border p-5">
            @if (selected(); as selected) {
              <div class="flex flex-wrap items-baseline justify-between gap-3">
                <h3 class="text-lg font-semibold">
                  {{ localeName(selected.locale) }}
                </h3>
                <span class="text-muted-foreground text-sm">
                  {{
                    coveragePercent(selected) === null
                      ? 'No source keys yet'
                      : coveragePercent(selected) + '% complete'
                  }}
                </span>
              </div>

              @if (selected.isSource) {
                <p class="text-muted-foreground mt-4 text-sm">
                  {{ localeName(selected.locale) }} is the source locale — every
                  key is defined here, so nothing is missing or extra relative
                  to itself.
                </p>
              } @else {
                <div
                  class="border-input mt-4 inline-flex items-center gap-1 rounded-lg border p-1"
                  role="group"
                  aria-label="Issue type"
                >
                  <button
                    type="button"
                    [attr.aria-pressed]="issueTab() === 'missing'"
                    (click)="selectIssueTab('missing')"
                    [class]="issueTabClass('missing')"
                  >
                    Missing {{ selected.missingKeys.length }}
                  </button>
                  <button
                    type="button"
                    [attr.aria-pressed]="issueTab() === 'extra'"
                    (click)="selectIssueTab('extra')"
                    [class]="issueTabClass('extra')"
                  >
                    Extra {{ selected.extraKeys.length }}
                  </button>
                </div>

                @if (issueTab() === 'extra' && selected.extraKeys.length > 0) {
                  <p class="text-muted-foreground mt-3 text-xs">
                    These keys exist in {{ localeName(selected.locale) }} but
                    not in the source locale ({{ localeName(sourceLocale()) }}).
                    They stay stored and can be edited in the
                    <a
                      [routerLink]="[
                        '/projects',
                        projectSlug(),
                        'catalogs',
                        selected.locale,
                      ]"
                      class="underline underline-offset-4"
                      >raw JSON catalog</a
                    >.
                  </p>
                }

                <ul class="mt-4 max-h-80 overflow-y-auto">
                  @if (visibleIssueKeys().length === 0) {
                    <li class="text-muted-foreground py-6 text-sm">
                      {{
                        issueTab() === 'missing'
                          ? 'No missing keys.'
                          : 'No extra keys.'
                      }}
                    </li>
                  } @else {
                    @for (key of visibleIssueKeys(); track key) {
                      <li>
                        @if (issueTab() === 'missing') {
                          <button
                            type="button"
                            (click)="jumpToKey(key)"
                            class="border-border hover:bg-muted focus-visible:ring-ring block w-full border-b px-3 py-2 text-left font-mono text-sm outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset"
                          >
                            {{ key }}
                          </button>
                        } @else {
                          <p
                            class="border-border text-muted-foreground border-b px-3 py-2 font-mono text-sm last:border-b-0"
                          >
                            {{ key }}
                          </p>
                        }
                      </li>
                    }
                  }
                </ul>
              }
            } @else {
              <p class="text-muted-foreground text-sm">
                Select a locale to see its missing and extra keys.
              </p>
            }
          </div>
        }
      </section>
    }
  `,
})
export class TranslationAnalysisPanel implements OnInit {
  readonly projectSlug = input.required<string>();

  /** Emits the missing key a human clicked, so the parent can switch to the Workspace and select it. */
  readonly openInWorkspace = output<string>();

  private readonly http = inject(HttpClient);

  protected readonly loading = signal(true);
  protected readonly loadError = signal('');

  protected readonly sourceLocale = signal('');
  protected readonly sourceKeys = signal(0);
  protected readonly completeKeys = signal(0);
  protected readonly incompleteKeys = signal(0);
  protected readonly locales = signal<TranslationLocaleAnalysis[]>([]);

  protected readonly selectedLocale = signal<string | null>(null);
  protected readonly issueTab = signal<IssueTab>('missing');

  protected readonly selected = computed(
    () =>
      this.locales().find(
        (locale) => locale.locale === this.selectedLocale(),
      ) ?? null,
  );

  protected readonly visibleIssueKeys = computed(() => {
    const selected = this.selected();

    if (!selected) {
      return [];
    }

    return this.issueTab() === 'missing'
      ? selected.missingKeys
      : selected.extraKeys;
  });

  ngOnInit(): void {
    void this.load();
  }

  protected localeName(locale: string): string {
    return localeDisplayName(locale);
  }

  protected selectLocale(locale: string): void {
    this.selectedLocale.set(locale);
    this.issueTab.set('missing');
  }

  protected selectIssueTab(tab: IssueTab): void {
    this.issueTab.set(tab);
  }

  protected issueTabClass(tab: IssueTab): string {
    return cn(
      ISSUE_TAB_BASE,
      this.issueTab() === tab
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-muted',
    );
  }

  protected jumpToKey(key: string): void {
    this.openInWorkspace.emit(key);
  }

  protected coveragePercent(locale: TranslationLocaleAnalysis): number | null {
    return locale.coverage === null ? null : Math.round(locale.coverage * 100);
  }

  protected async reload(): Promise<void> {
    this.loading.set(true);
    await this.load();
  }

  private async load(): Promise<void> {
    this.loadError.set('');

    try {
      const response = await firstValueFrom(
        this.http.get<TranslationAnalysisResponse>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/translations/analysis`,
        ),
      );
      const analysis = response.analysis;

      this.sourceLocale.set(analysis.sourceLocale);
      this.sourceKeys.set(analysis.sourceKeys);
      this.completeKeys.set(analysis.completeKeys);
      this.incompleteKeys.set(analysis.incompleteKeys);
      this.locales.set(analysis.locales);

      const current = this.selectedLocale();
      const stillExists =
        current !== null &&
        analysis.locales.some((locale) => locale.locale === current);

      if (!stillExists) {
        this.selectedLocale.set(null);
      }
    } catch {
      this.loadError.set('Translation analysis could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}
