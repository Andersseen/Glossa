import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'ui-select-separator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block -mx-1 my-1 h-px bg-muted',
  },
  template: ``,
})
export class UiSelectSeparator {}
