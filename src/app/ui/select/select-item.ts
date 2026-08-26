import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { NgpSelectOption } from 'ng-primitives/select';

@Component({
  selector: 'ui-select-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpSelectOption],
  template: `
    <div
      ngpSelectOption
      [ngpSelectOptionValue]="value()"
      [ngpSelectOptionDisabled]="disabled()"
      class="group focus:bg-muted focus:text-muted-foreground relative flex w-full cursor-pointer items-center rounded-sm py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      <span
        class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="hidden h-4 w-4 group-data-[selected]:block"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <ng-content />
    </div>
  `,
})
export class UiSelectItem {
  readonly value = input<unknown>(undefined);
  readonly disabled = input(false, { transform: booleanAttribute });
}
