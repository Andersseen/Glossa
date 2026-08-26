import { Directive } from '@angular/core';
import { NgpDialogTitle } from 'ng-primitives/dialog';

@Directive({
  selector: '[uiDrawerTitle]',
  hostDirectives: [NgpDialogTitle],
  host: {
    class: 'text-lg font-semibold leading-none tracking-tight',
  },
})
export class UiDrawerTitle {}
