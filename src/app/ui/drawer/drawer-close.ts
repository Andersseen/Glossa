import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgpDialogRef } from 'ng-primitives/dialog';

import { cn } from '../utils';

const BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer';

@Component({
  selector: 'ui-drawer-close',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    role: 'button',
    tabindex: '0',
    '(click)': 'close()',
    '(keydown.enter)': 'close()',
    '(keydown.space)': 'close(); $event.preventDefault()',
  },
  template: `
    <ng-content />
    @if (srLabel()) {
      <span class="sr-only">{{ srLabel() }}</span>
    }
  `,
})
export class UiDrawerClose {
  private readonly dialogRef = inject(NgpDialogRef);

  /** Replaces the icon-button defaults — e.g. a `buttonVariants(...)` string for a text action. */
  readonly class = input<string>('');
  /**
   * Screen-reader-only name, for the icon-only default. Set it to `''` when the projected content
   * is already the accessible name (a "Cancel" action), so the name is not doubled up.
   */
  readonly srLabel = input<string>('Close');

  protected readonly classes = computed(() => cn(this.class() || BASE_CLASS));

  close(): void {
    this.dialogRef.close();
  }
}
