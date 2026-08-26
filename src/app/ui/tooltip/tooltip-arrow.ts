import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { NgpTooltipArrow } from 'ng-primitives/tooltip';

@Component({
  selector: 'ui-tooltip-arrow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpTooltipArrow],
  template: `
    <span
      ngpTooltipArrow
      [ngpTooltipArrowPadding]="padding()"
      class="bg-foreground block h-2 w-2 rotate-45"
      [class.hidden]="hidden()"
    ></span>
  `,
})
export class UiTooltipArrow {
  readonly padding = input<number | undefined>(4);
  readonly hidden = input(false, { transform: booleanAttribute });
}
