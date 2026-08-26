import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgpDescription } from 'ng-primitives/form-field';

@Component({
  selector: 'ui-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpDescription],
  template: `
    <span ngpDescription class="text-muted-foreground text-sm">
      <ng-content />
    </span>
  `,
})
export class UiHint {}
