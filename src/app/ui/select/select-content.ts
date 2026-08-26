import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgpSelectDropdown } from 'ng-primitives/select';

@Component({
  selector: 'ui-select-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpSelectDropdown],
  template: `
    <div
      ngpSelectDropdown
      class="border-border bg-surface text-surface-foreground animate-in fade-in-80 zoom-in-95 absolute z-50 block w-full max-w-[var(--ngp-select-width)] min-w-[var(--ngp-select-width)] overflow-hidden rounded-md border shadow-md"
    >
      <div class="flex w-full flex-col p-1">
        <ng-content />
      </div>
    </div>
  `,
})
export class UiSelectContent {}
