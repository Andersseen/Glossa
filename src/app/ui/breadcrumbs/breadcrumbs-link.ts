import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgpBreadcrumbLink } from 'ng-primitives/breadcrumbs';

@Component({
  selector: 'ui-breadcrumb-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpBreadcrumbLink],
  template: `
    <a
      ngpBreadcrumbLink
      [href]="href()"
      class="hover:text-foreground transition-colors"
    >
      <ng-content />
    </a>
  `,
})
export class UiBreadcrumbLink {
  readonly href = input<string>('#');
}
