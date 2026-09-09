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
import { LmnShieldCheckIcon } from 'lumen-icons/shield-check';

import { AuthClient } from '../auth/auth-client';
import { UiButton } from '../ui/button';
import { UiError, UiFormField, UiLabel } from '../ui/form-field';
import { UiInput } from '../ui/input';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'DevAuth sign-in was cancelled.',
  invalid_state:
    'Your DevAuth sign-in could not be verified. Please try again.',
  expired_transaction: 'Your DevAuth sign-in took too long. Please try again.',
  token_exchange_failed: 'DevAuth sign-in failed. Please try again.',
  userinfo_failed: 'DevAuth sign-in failed. Please try again.',
  account_not_linked:
    'Your DevAuth identity is not linked to a Glossa account.',
  provider_unavailable:
    'DevAuth is unavailable right now. Please try again shortly.',
  sso_failed: 'DevAuth sign-in failed. Please try again.',
};

@Component({
  selector: 'app-signin',
  imports: [
    LmnArrowRightEndOnRectangleIcon,
    LmnShieldCheckIcon,
    UiButton,
    UiError,
    UiFormField,
    UiLabel,
    UiInput,
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

        @if (providerError) {
          <ui-error>{{ providerError }}</ui-error>
        }

        <ui-button
          type="button"
          class="gap-2"
          [disabled]="ssoRedirecting()"
          (click)="continueWithDevAuth()"
        >
          <lmn-shield-check slot="leading" aria-hidden="true" [size]="16" />
          {{ ssoRedirecting() ? 'Redirecting…' : 'Continue with DevAuth' }}
        </ui-button>

        <details class="grid gap-5">
          <summary
            class="text-muted-foreground focus-visible:ring-ring cursor-pointer text-sm font-medium select-none focus-visible:ring-2 focus-visible:outline-none"
          >
            Use local credentials
          </summary>

          <form class="mt-5 grid gap-5" (submit)="submit($event)" novalidate>
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
        </details>
      </section>
    </main>
  `,
})
export default class SigninPage {
  private readonly auth = inject(AuthClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly providerError = mapSsoError(
    this.route.snapshot.queryParamMap.get('error'),
  );

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly submitting = signal(false);
  protected readonly ssoRedirecting = signal(false);
  protected readonly error = signal('');
  protected readonly valid = computed(
    () => this.email().trim().length > 0 && this.password().length > 0,
  );

  protected continueWithDevAuth(): void {
    this.ssoRedirecting.set(true);
    this.auth.loginWithDevAuth(this.safeRedirect());
  }

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

function mapSsoError(code: string | null): string {
  if (!code) return '';
  return (
    SSO_ERROR_MESSAGES[code] ?? 'DevAuth sign-in failed. Please try again.'
  );
}

function readSigninError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'Invalid email or password.';
  }

  return 'Sign in failed.';
}
