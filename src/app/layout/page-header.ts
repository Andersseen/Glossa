import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between',
  },
  template: `
    <div class="min-w-0">
      @if (eyebrow()) {
        <p class="text-muted-foreground text-sm font-medium">{{ eyebrow() }}</p>
      }
      <h1 class="text-3xl font-semibold tracking-normal">{{ title() }}</h1>
      @if (description()) {
        <p class="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
          {{ description() }}
        </p>
      }
      <ng-content select="[slot=meta]" />
    </div>
    <ng-content />
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly eyebrow = input('');
}
