import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export default class Home {
  private readonly router = inject(Router);

  constructor() {
    void this.router.navigateByUrl('/projects', { replaceUrl: true });
  }
}
