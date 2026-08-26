import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgpBreadcrumbs } from 'ng-primitives/breadcrumbs';

@Component({
  selector: 'ui-breadcrumbs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgpBreadcrumbs],
  template: `<nav ngpBreadcrumbs aria-label="breadcrumb"><ng-content /></nav>`,
})
export class UiBreadcrumbs {}
