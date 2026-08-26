import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgpBreadcrumbPage } from 'ng-primitives/breadcrumbs';

@Component({
  selector: 'ui-breadcrumb-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpBreadcrumbPage],
  template: `
    <span ngpBreadcrumbPage class="text-foreground font-normal">
      <ng-content />
    </span>
  `,
})
export class UiBreadcrumbPage {}
