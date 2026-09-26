import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';

import { AuthClient } from '../../auth/auth-client';
import { UiBadge } from '../../ui/badge';
import { UiButton } from '../../ui/button';
import { buttonVariants } from '../../ui/button/variants';
import {
  UiDrawer,
  UiDrawerClose,
  UiDrawerContent,
  UiDrawerDescription,
  UiDrawerOverlay,
  UiDrawerTitle,
} from '../../ui/drawer';
import { UiError, UiFormField, UiHint, UiLabel } from '../../ui/form-field';
import { UiInput } from '../../ui/input';

type DeployHookFailure = 'http_error' | 'network_error' | 'timeout';

type DeployHookView =
  | { configured: false }
  | {
      configured: true;
      provider: 'cloudflare';
      enabled: boolean;
      urlPreview: string;
      lastAttemptAt: string | null;
      lastSuccessAt: string | null;
      lastStatusCode: number | null;
      lastError: DeployHookFailure | null;
    };

type ConfiguredHook = Extract<DeployHookView, { configured: true }>;

type TestResponse = {
  success: boolean;
  statusCode?: number;
  error?: DeployHookFailure;
  attemptedAt: string;
  deployHook: DeployHookView;
};

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'succeeded' }
  | { kind: 'failed'; message: string };

/**
 * Admin-only management of the project's static-site deploy hook (Cloudflare), shown inside the
 * Delivery tab. The hook URL is a credential: it is typed once into the drawer, sent to the server,
 * and cleared from memory — every later render shows the server's masked `urlPreview` only.
 */
@Component({
  selector: 'app-deploy-hook-panel',
  imports: [
    UiBadge,
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerDescription,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
    UiFormField,
    UiHint,
    UiInput,
    UiLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-10" aria-labelledby="static-rebuild-heading">
      <h3 id="static-rebuild-heading" class="text-sm font-semibold">
        Static site rebuild
      </h3>

      @if (!isAdmin()) {
        <p class="text-muted-foreground mt-1 text-xs">
          Automatic rebuilds for static sites are managed by project admins.
        </p>
      } @else if (loading()) {
        <p class="text-muted-foreground mt-3 text-sm">Loading deploy hook…</p>
      } @else if (loadError()) {
        <ui-error class="mt-3">{{ loadError() }}</ui-error>
      } @else {
        @if (configuredHook(); as hook) {
          <div class="border-border mt-3 rounded-lg border p-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-sm font-medium">Cloudflare Deploy Hook</p>
              <ui-badge [variant]="hook.enabled ? 'solid' : 'secondary'">
                {{
                  hook.enabled
                    ? 'Configured · Enabled'
                    : 'Configured · Disabled'
                }}
              </ui-badge>
            </div>

            <dl class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div class="sm:col-span-2">
                <dt class="text-muted-foreground text-xs">Endpoint</dt>
                <dd class="mt-1">
                  <code
                    class="text-xs break-all"
                    data-testid="deploy-hook-preview"
                  >
                    {{ hook.urlPreview }}
                  </code>
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground text-xs">
                  Last deployment trigger
                </dt>
                <dd class="mt-1">
                  {{
                    hook.lastAttemptAt
                      ? formatDate(hook.lastAttemptAt)
                      : 'Never'
                  }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground text-xs">Last result</dt>
                <dd class="mt-1" data-testid="deploy-hook-last-result">
                  {{ lastResult() }}
                </dd>
              </div>
            </dl>

            <div class="mt-5 flex flex-wrap gap-2">
              <ui-button
                type="button"
                size="sm"
                [disabled]="busy()"
                (click)="test()"
              >
                {{ testState().kind === 'testing' ? 'Testing…' : 'Test hook' }}
              </ui-button>
              <ui-button
                type="button"
                size="sm"
                variant="outline"
                [disabled]="busy()"
                (click)="setEnabled(!hook.enabled)"
              >
                {{ hook.enabled ? 'Disable' : 'Enable' }}
              </ui-button>
              <button
                type="button"
                [uiDrawer]="configureDrawer"
                [disabled]="busy()"
                (click)="resetForm()"
                [class]="outlineSmallButtonClass"
              >
                Replace hook
              </button>
              @if (confirmingRemove()) {
                <span class="flex items-center gap-2">
                  <span class="text-xs font-medium">Remove the hook?</span>
                  <ui-button
                    type="button"
                    size="sm"
                    variant="destructive"
                    [disabled]="busy()"
                    (click)="remove()"
                  >
                    Confirm remove
                  </ui-button>
                  <ui-button
                    type="button"
                    size="sm"
                    variant="outline"
                    [disabled]="busy()"
                    (click)="confirmingRemove.set(false)"
                  >
                    Cancel
                  </ui-button>
                </span>
              } @else {
                <ui-button
                  type="button"
                  size="sm"
                  variant="destructive"
                  [disabled]="busy()"
                  (click)="confirmingRemove.set(true)"
                >
                  Remove
                </ui-button>
              }
            </div>

            <p
              class="mt-3 text-sm"
              aria-live="polite"
              data-testid="deploy-hook-test-status"
            >
              @switch (testState().kind) {
                @case ('testing') {
                  Testing…
                }
                @case ('succeeded') {
                  Deployment triggered.
                }
                @case ('failed') {
                  <span class="text-error">{{ testMessage() }}</span>
                }
              }
            </p>
          </div>
        } @else {
          <div
            class="border-border mt-3 rounded-lg border border-dashed px-5 py-6"
          >
            <p class="text-sm font-medium">No deploy hook configured.</p>
            <p class="text-muted-foreground mt-1 max-w-lg text-sm">
              For static sites, Glossa can trigger a new Cloudflare build after
              translation content changes.
            </p>
            <button
              type="button"
              class="mt-4"
              [uiDrawer]="configureDrawer"
              (click)="resetForm()"
              [class]="solidButtonClass"
            >
              Configure Cloudflare hook
            </button>
          </div>
        }

        @if (actionError()) {
          <ui-error class="mt-3">{{ actionError() }}</ui-error>
        }
      }
    </section>

    <ng-template #configureDrawer let-close="close">
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        class="flex w-[480px] max-w-[92vw] flex-col p-5"
      >
        <h2 uiDrawerTitle>
          {{
            configuredHook() ? 'Replace deploy hook' : 'Configure deploy hook'
          }}
        </h2>
        <p uiDrawerDescription class="mt-2">
          Glossa sends one POST to this URL after each translation change, so
          your static site rebuilds with the new content.
        </p>

        <form
          class="mt-6 flex flex-1 flex-col gap-5"
          (submit)="save($event, close)"
          novalidate
        >
          <ui-form-field>
            <ui-label htmlFor="deploy-hook-url" [error]="!!formError()">
              Cloudflare Deploy Hook URL
            </ui-label>
            <ui-input
              id="deploy-hook-url"
              type="url"
              [value]="hookUrl()"
              (valueChange)="setHookUrl($event)"
              placeholder="https://api.cloudflare.com/client/v4/…/deploy_hooks/…"
              autocomplete="off"
              required
              [ariaDescribedBy]="
                formError()
                  ? 'deploy-hook-url-error deploy-hook-url-hint'
                  : 'deploy-hook-url-hint'
              "
            />
            @if (formError()) {
              <ui-error id="deploy-hook-url-error">{{ formError() }}</ui-error>
            }
            <ui-hint id="deploy-hook-url-hint">
              The hook URL is a secret. It is stored server-side and will not be
              displayed again after saving.
            </ui-hint>
          </ui-form-field>

          <p class="text-muted-foreground text-xs">
            Find it in Cloudflare → Workers &amp; Pages → your project →
            Settings → Builds → Deploy Hooks.
          </p>

          <div class="mt-auto flex justify-end gap-3 pt-4">
            <ui-drawer-close
              srLabel=""
              [class]="cancelButtonClass"
              (click)="resetForm()"
            >
              Cancel
            </ui-drawer-close>
            <ui-button type="submit" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save hook' }}
            </ui-button>
          </div>
        </form>
      </section>
    </ng-template>
  `,
})
export class DeployHookPanel {
  readonly projectSlug = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthClient);

  protected readonly solidButtonClass = buttonVariants({ size: 'md' });
  protected readonly outlineSmallButtonClass = buttonVariants({
    variant: 'outline',
    size: 'sm',
  });
  protected readonly cancelButtonClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly isAdmin = computed(
    () => this.auth.user()?.role === 'admin',
  );

  protected readonly hook = signal<DeployHookView>({ configured: false });
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly actionError = signal('');
  protected readonly updating = signal(false);
  protected readonly confirmingRemove = signal(false);
  protected readonly testState = signal<TestState>({ kind: 'idle' });

  protected readonly hookUrl = signal('');
  protected readonly formError = signal('');
  protected readonly saving = signal(false);

  protected readonly configuredHook = computed<ConfiguredHook | null>(() => {
    const hook = this.hook();
    return hook.configured ? hook : null;
  });

  protected readonly busy = computed(
    () => this.updating() || this.testState().kind === 'testing',
  );

  protected readonly testMessage = computed(() => {
    const state = this.testState();
    return state.kind === 'failed' ? state.message : '';
  });

  protected readonly lastResult = computed(() => {
    const hook = this.configuredHook();

    if (!hook?.lastAttemptAt) {
      return 'No trigger yet';
    }

    if (!hook.lastError) {
      return `Succeeded · HTTP ${hook.lastStatusCode}`;
    }

    return describeFailure(hook.lastError, hook.lastStatusCode);
  });

  constructor() {
    // Browser-only, like `AccessTokensPanel`: this panel renders inside an async-loaded ancestor.
    afterNextRender(() => void this.load());
  }

  private get endpoint(): string {
    return `/api/projects/${encodeURIComponent(this.projectSlug())}/deploy-hook`;
  }

  protected async load(): Promise<void> {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<{ deployHook: DeployHookView }>(this.endpoint),
      );
      this.hook.set(response.deployHook);
    } catch {
      this.loadError.set('The deploy hook could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  protected resetForm(): void {
    this.hookUrl.set('');
    this.formError.set('');
    this.saving.set(false);
  }

  protected setHookUrl(value: string): void {
    this.hookUrl.set(value);
    this.formError.set('');
  }

  protected async save(event: Event, close: () => void): Promise<void> {
    event.preventDefault();

    if (this.saving()) {
      return;
    }

    const url = this.hookUrl().trim();

    if (!url) {
      this.formError.set('Paste the deploy hook URL from Cloudflare.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    try {
      const response = await firstValueFrom(
        this.http.put<{ deployHook: DeployHookView }>(this.endpoint, {
          provider: 'cloudflare',
          url,
          ...(this.configuredHook() ? {} : { enabled: true }),
        }),
      );
      this.hook.set(response.deployHook);
      this.testState.set({ kind: 'idle' });
      this.actionError.set('');
      // The secret has done its job; do not keep it around in component state.
      this.hookUrl.set('');
      close();
    } catch (error) {
      this.formError.set(
        readApiMessage(error, 'The deploy hook could not be saved.'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async setEnabled(enabled: boolean): Promise<void> {
    await this.mutate(
      () =>
        this.http.put<{ deployHook: DeployHookView }>(this.endpoint, {
          enabled,
        }),
      'The deploy hook could not be updated.',
    );
  }

  protected async remove(): Promise<void> {
    await this.mutate(
      () => this.http.delete<{ deployHook: DeployHookView }>(this.endpoint),
      'The deploy hook could not be removed.',
    );
    this.confirmingRemove.set(false);
  }

  protected async test(): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.testState.set({ kind: 'testing' });
    this.actionError.set('');

    try {
      const response = await firstValueFrom(
        this.http.post<TestResponse>(`${this.endpoint}/test`, {}),
      );
      this.hook.set(response.deployHook);
      this.testState.set(
        response.success
          ? { kind: 'succeeded' }
          : {
              kind: 'failed',
              message: describeTestFailure(
                response.error ?? 'http_error',
                response.statusCode ?? null,
              ),
            },
      );
    } catch (error) {
      this.testState.set({
        kind: 'failed',
        message: readApiMessage(error, 'The deploy hook could not be tested.'),
      });
    }
  }

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private async mutate(
    request: () => Observable<{ deployHook: DeployHookView }>,
    fallback: string,
  ): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.updating.set(true);
    this.actionError.set('');

    try {
      const response = await firstValueFrom(request());
      this.hook.set(response.deployHook);
      this.testState.set({ kind: 'idle' });
    } catch (error) {
      this.actionError.set(readApiMessage(error, fallback));
    } finally {
      this.updating.set(false);
    }
  }
}

function describeFailure(
  error: DeployHookFailure,
  statusCode: number | null,
): string {
  switch (error) {
    case 'timeout':
      return 'Deploy hook timed out';
    case 'network_error':
      return 'Deploy hook failed · could not reach Cloudflare';
    case 'http_error':
      return statusCode
        ? `Deploy hook failed · HTTP ${statusCode}`
        : 'Deploy hook failed';
  }
}

/** Test-button copy: says what happened, and that content is unaffected either way. */
function describeTestFailure(
  error: DeployHookFailure,
  statusCode: number | null,
): string {
  const what =
    error === 'timeout'
      ? 'Deploy hook timed out.'
      : error === 'network_error'
        ? 'Deploy hook failed: Cloudflare could not be reached.'
        : statusCode
          ? `Deploy hook failed. The deploy hook returned HTTP ${statusCode}.`
          : 'Deploy hook failed.';

  return `${what} Your translations were saved normally.`;
}

function readApiMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
