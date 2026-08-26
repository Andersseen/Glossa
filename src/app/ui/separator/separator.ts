import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NgpSeparator } from 'ng-primitives/separator';

@Component({
  selector: 'ui-separator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: NgpSeparator,
      inputs: ['ngpSeparatorOrientation: orientation'],
    },
  ],
  host: {
    '[class]': 'classes()',
  },
  template: ``,
})
export class UiSeparator {
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');

  protected readonly classes = computed(() => {
    const base = 'block shrink-0 bg-border';
    return this.orientation() === 'vertical'
      ? `${base} w-px h-full`
      : `${base} h-px w-full`;
  });
}
