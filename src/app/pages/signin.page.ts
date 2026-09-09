import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LmnArrowRightEndOnRectangleIcon } from 'lumen-icons/arrow-right-end-on-rectangle';

import { AuthClient } from '../auth/auth-client';
import { UiButton } from '../ui/button';
import { UiError, UiFormField, UiLabel } from '../ui/form-field';
import { UiInput } from '../ui/input';

@Component({
  selector: 'app-signin',
  imports: [
    LmnArrowRightEndOnRectangleIcon,
    UiButton,
    UiError,
    UiFormField,
    UiInput,
    UiLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="bg-background text-foreground flex min-h-screen items-center justify-center px-5 py-10"
    >
      <section class="grid w-full max-w-sm gap-8">
        <header class="grid gap-2">
          <p class="text-muted-foreground text-sm font-medium">Glossa</p>
          <h1 class="text-3xl font-semibold tracking-normal">Sign in</h1>
        </header>

        <form class="grid gap-5" (submit)="submit($event)" novalidate>
          <ui-form-field>
            <ui-label htmlFor="email">Email</ui-label>
            <ui-input
              id="email"
              type="email"
              autocomplete="email"
              [value]="email()"
              (valueChange)="email.set($event)"
              required
            />
          </ui-form-field>

          <ui-form-field>
            <ui-label htmlFor="password">Password</ui-label>
            <ui-input
              id="password"
              type="password"
              autocomplete="current-password"
              [value]="password()"
              (valueChange)="password.set($event)"
              required
            />
          </ui-form-field>

          @if (error()) {
            <ui-error>{{ error() }}</ui-error>
          }

          <ui-button type="submit" class="gap-2" [disabled]="submitting()">
            <lmn-arrow-right-end-on-rectangle
              slot="leading"
              aria-hidden="true"
              [size]="16"
            />
            {{ submitting() ? 'Signing in...' : 'Sign in' }}
          </ui-button>
        </form>
      </section>
    </main>
  `,
})
export default class SigninPage {
  private readonly auth = inject(AuthClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly valid = computed(
    () => this.email().trim().length > 0 && this.password().length > 0,
  );

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.error.set('');

    if (!this.valid()) {
      this.error.set('Email and password are required.');
      return;
    }

    this.submitting.set(true);

    try {
      await this.auth.signin(this.email().trim(), this.password());
      await this.router.navigateByUrl(this.safeRedirect());
    } catch (error) {
      this.error.set(readSigninError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private safeRedirect(): string {
    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    return redirect?.startsWith('/') && !redirect.startsWith('//')
      ? redirect
      : '/projects';
  }
}

function readSigninError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'Invalid email or password.';
  }

  return 'Sign in failed.';
}
