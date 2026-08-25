import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { NgpButton } from 'ng-primitives/button';

import { cn } from '../utils';
import { buttonVariants, type ButtonVariants } from './variants';

@Component({
  selector: 'ui-button',
  imports: [NgpButton],
  template: `
    <button
      ngpButton
      [type]="type()"
      [disabled]="disabled()"
      [class]="classes()"
      [attr.data-variant]="variant()"
      [attr.data-size]="size()"
    >
      <ng-content select="[slot=leading]" />
      <ng-content />
      <ng-content select="[slot=trailing]" />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiButton {
  readonly variant = input<ButtonVariants['variant']>('solid');
  readonly size = input<ButtonVariants['size']>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });
  readonly class = input<string>('');
  readonly customClass = input<string>('');

  protected readonly classes = computed(() =>
    cn(
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this.class(),
      this.customClass(),
    ),
  );
}
