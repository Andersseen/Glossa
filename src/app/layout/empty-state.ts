import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { UiCard, UiCardContent } from '../ui/card';

@Component({
  selector: 'app-empty-state',
  imports: [UiCard, UiCardContent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-card>
      <ui-card-content class="grid justify-items-start gap-4 pt-6">
        <ng-content select="[slot=icon]" />
        <div>
          <h2 class="text-base font-semibold">{{ title() }}</h2>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            {{ description() }}
          </p>
        </div>
        <ng-content />
      </ui-card-content>
    </ui-card>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
