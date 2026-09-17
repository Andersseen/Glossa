import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';

import { cn } from '../../../ui/utils';
import { TranslationAnalysisPanel } from './translation-analysis';
import { TranslationWorkspace } from './translation-workspace';

type TranslationsMode = 'workspace' | 'analysis';

const MODE_BUTTON_BASE =
  'rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The Translations tab's own lightweight mode switch — Workspace stays the default surface for
 * everyday editing, Analysis is a supplementary read-only view. Not a second top-level project
 * tab: both modes live inside the one `Translations` tab in the project page.
 *
 * A plain segmented button group (the same idiom `TranslationWorkspace` already uses for its
 * All/Missing/Complete filter) rather than a second, nested `ui-tabs` — `ui-tabs` wraps
 * `NgpTabset`, and its tab/panel registry is designed for one tabset per page region, not one
 * nested inside another.
 */
@Component({
  selector: 'app-translations-panel',
  imports: [TranslationAnalysisPanel, TranslationWorkspace],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border-input inline-flex items-center gap-1 rounded-lg border p-1"
      role="group"
      aria-label="Translations view"
    >
      <button
        type="button"
        [attr.aria-pressed]="mode() === 'workspace'"
        (click)="selectMode('workspace')"
        [class]="modeButtonClass('workspace')"
      >
        Workspace
      </button>
      <button
        type="button"
        [attr.aria-pressed]="mode() === 'analysis'"
        (click)="selectMode('analysis')"
        [class]="modeButtonClass('analysis')"
      >
        Analysis
      </button>
    </div>

    <div class="mt-6" [class.hidden]="mode() !== 'workspace'">
      <app-translation-workspace
        [projectSlug]="projectSlug()"
        [canWrite]="canWrite()"
        [focusRequest]="focusRequest()"
      />
    </div>

    @if (analysisOpened()) {
      <div class="mt-6" [class.hidden]="mode() !== 'analysis'">
        <app-translation-analysis
          [projectSlug]="projectSlug()"
          (openInWorkspace)="onOpenInWorkspace($event)"
        />
      </div>
    }
  `,
})
export class TranslationsPanel {
  readonly projectSlug = input.required<string>();
  readonly canWrite = input(false);

  protected readonly mode = signal<TranslationsMode>('workspace');
  /** Analysis is only fetched once the human actually opens it, same as the Workspace lazy-mounts on the Translations tab. */
  protected readonly analysisOpened = signal(false);
  protected readonly focusRequest = signal<{
    key: string;
    token: number;
  } | null>(null);

  private focusToken = 0;

  protected selectMode(mode: TranslationsMode): void {
    this.mode.set(mode);

    if (mode === 'analysis') {
      this.analysisOpened.set(true);
    }
  }

  protected modeButtonClass(mode: TranslationsMode): string {
    return cn(
      MODE_BUTTON_BASE,
      this.mode() === mode
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-muted',
    );
  }

  protected onOpenInWorkspace(key: string): void {
    this.focusToken += 1;
    this.focusRequest.set({ key, token: this.focusToken });
    this.selectMode('workspace');
  }
}
