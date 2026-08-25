import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block rounded-lg border border-border bg-card text-card-foreground shadow-sm',
  },
  template: `<ng-content />`,
})
export class UiCard {}

@Component({
  selector: 'ui-card-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col gap-1.5 p-6',
  },
  template: `<ng-content />`,
})
export class UiCardHeader {}

@Component({
  selector: 'ui-card-title',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block text-lg font-semibold leading-none tracking-tight',
  },
  template: `<ng-content />`,
})
export class UiCardTitle {}

@Component({
  selector: 'ui-card-description',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block text-sm text-muted-foreground',
  },
  template: `<ng-content />`,
})
export class UiCardDescription {}

@Component({
  selector: 'ui-card-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block p-6 pt-0',
  },
  template: `<ng-content />`,
})
export class UiCardContent {}

@Component({
  selector: 'ui-card-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex items-center p-6 pt-0',
  },
  template: `<ng-content />`,
})
export class UiCardFooter {}
