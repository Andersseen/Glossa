import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgpTextarea } from 'ng-primitives/textarea';
import { injectFormControlState } from '../form-control-state';

@Component({
  selector: 'ui-textarea',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpTextarea],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiTextarea),
      multi: true,
    },
  ],
  host: {
    class: 'block w-full',
    '[attr.id]': 'null',
  },
  template: `
    <textarea
      ngpTextarea
      [id]="id()"
      [name]="name()"
      [placeholder]="placeholder()"
      [attr.aria-label]="ariaLabel() || null"
      [attr.aria-describedby]="ariaDescribedBy() || null"
      [readonly]="readonly()"
      [required]="required()"
      [disabled]="isDisabled()"
      [rows]="rows()"
      [spellcheck]="spellcheck()"
      [value]="value()"
      [attr.aria-invalid]="formControlState.invalid() ? 'true' : null"
      (input)="onInput($event)"
      (blur)="onTouched()"
      class="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring block w-full resize-y rounded-lg border px-3 py-2 font-mono text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    ></textarea>
  `,
})
export class UiTextarea implements ControlValueAccessor {
  protected readonly formControlState = injectFormControlState();

  readonly id = input('');
  readonly name = input('');
  readonly placeholder = input('');
  readonly ariaLabel = input('');
  readonly ariaDescribedBy = input('');
  readonly rows = input(12);
  readonly value = model('');

  readonly disabled = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });
  readonly readonly = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });
  readonly required = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });
  readonly spellcheck = input<boolean, unknown>(false, {
    transform: booleanAttribute,
  });

  private readonly controlDisabled = signal(false);
  protected readonly isDisabled = computed(
    () => this.disabled() || this.controlDisabled(),
  );

  private onChange: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  protected onInput(event: Event): void {
    const nextValue = (event.target as HTMLTextAreaElement).value;
    this.value.set(nextValue);
    this.onChange(nextValue);
  }

  writeValue(value: string | null | undefined): void {
    this.value.set(value ?? '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.controlDisabled.set(isDisabled);
  }
}
