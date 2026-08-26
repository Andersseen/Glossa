import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { NgpLabel } from 'ng-primitives/form-field';

@Component({
  selector: 'ui-label',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpLabel],
  template: `
    <label
      ngpLabel
      [class.text-error]="error()"
      [attr.for]="htmlFor()"
      class="text-foreground text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
    >
      <ng-content />
    </label>
  `,
})
export class UiLabel {
  readonly error = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });
  readonly htmlFor = input<string>('');
}
