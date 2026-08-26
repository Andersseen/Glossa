import { booleanAttribute, Directive, input, output } from '@angular/core';
import { NgpDialogTrigger } from 'ng-primitives/dialog';

@Directive({
  selector: '[uiDrawer]',
  hostDirectives: [
    {
      directive: NgpDialogTrigger,
      inputs: [
        'ngpDialogTrigger: uiDrawer',
        'ngpDialogTriggerCloseOnEscape: closeOnEscape',
      ],
      outputs: ['ngpDialogTriggerClosed: closed'],
    },
  ],
})
export class UiDrawer {
  readonly closeOnEscape = input<boolean, unknown>(true, {
    transform: booleanAttribute,
  });
  readonly closed = output<unknown>();
}
