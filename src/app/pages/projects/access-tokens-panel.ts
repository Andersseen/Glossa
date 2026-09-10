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
import { firstValueFrom } from 'rxjs';
import { LmnCopyIcon } from 'lumen-icons/copy';
import { LmnKeyIcon } from 'lumen-icons/key';
import { LmnPlusIcon } from 'lumen-icons/plus';
import { LmnXMarkIcon } from 'lumen-icons/x-mark';

import { AuthClient } from '../../auth/auth-client';
import { UiBadge } from '../../ui/badge';
import type { BadgeVariants } from '../../ui/badge/variants';
import { UiButton } from '../../ui/button';
import {
  UiDrawer,
  UiDrawerClose,
  UiDrawerContent,
  UiDrawerOverlay,
  UiDrawerTitle,
} from '../../ui/drawer';
import { UiError, UiFormField, UiHint, UiLabel } from '../../ui/form-field';
import { UiInput } from '../../ui/input';

type ProjectTokenScope = 'catalog:read' | 'catalog:write';
type ProjectTokenStatus = 'active' | 'revoked' | 'expired';

type ProjectAccessToken = {
  id: string;
  name: string;
  scopes: ProjectTokenScope[];
  status: ProjectTokenStatus;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

const STATUS_BADGE_VARIANT: Record<
  ProjectTokenStatus,
  NonNullable<BadgeVariants['variant']>
> = {
  active: 'solid',
  revoked: 'destructive',
  expired: 'secondary',
};

const STATUS_LABEL: Record<ProjectTokenStatus, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};

@Component({
  selector: 'app-access-tokens-panel',
  imports: [
    UiBadge,
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
    UiFormField,
    UiHint,
    UiInput,
    UiLabel,
    LmnCopyIcon,
    LmnKeyIcon,
    LmnPlusIcon,
    LmnXMarkIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isAdmin()) {
      <p class="text-muted-foreground text-sm">
        Only project admins can create or manage access tokens.
      </p>
    } @else {
      <div class="flex flex-wrap items-start justify-between gap-4">
        <p class="text-muted-foreground max-w-lg text-sm">
          Project-bound tokens let an AI coding agent, CI process, or developer
          tool discover this project and read or update its translation catalogs
          without a human browser session.
        </p>
        <button
          type="button"
          [uiDrawer]="createTokenDrawer"
          (click)="openCreateDrawer()"
          class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-2"
        >
          <lmn-plus aria-hidden="true" [size]="16" />
          New token
        </button>
      </div>

      @if (loading()) {
        <p class="text-muted-foreground mt-6 text-sm">Loading tokens...</p>
      } @else if (loadError() && tokens().length === 0) {
        <p class="text-destructive mt-6 text-sm">{{ loadError() }}</p>
      } @else if (tokens().length === 0) {
        <div
          class="border-border mt-6 grid place-items-center rounded-lg border border-dashed px-6 py-10 text-center"
        >
          <lmn-key
            aria-hidden="true"
            [size]="24"
            class="text-muted-foreground"
          />
          <p class="text-muted-foreground mt-3 text-sm">
            No access tokens yet. Create one to let an agent or CI process read
            and write this project's catalogs.
          </p>
        </div>
      } @else {
        <div class="border-border mt-6 overflow-x-auto rounded-lg border">
          <table class="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr
                class="border-border text-muted-foreground border-b text-xs uppercase"
              >
                <th scope="col" class="px-4 py-3 font-medium">Name</th>
                <th scope="col" class="px-4 py-3 font-medium">Scopes</th>
                <th scope="col" class="px-4 py-3 font-medium">Status</th>
                <th scope="col" class="px-4 py-3 font-medium">Created</th>
                <th scope="col" class="px-4 py-3 font-medium">Last used</th>
                <th scope="col" class="px-4 py-3 font-medium">Expires</th>
                <th scope="col" class="px-4 py-3 font-medium">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (token of tokens(); track token.id) {
                <tr
                  class="border-border last:border-b-0 [&:not(:last-child)]:border-b"
                >
                  <td class="px-4 py-3 font-medium">{{ token.name }}</td>
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap gap-1">
                      @for (scope of token.scopes; track scope) {
                        <ui-badge variant="outline">{{ scope }}</ui-badge>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <ui-badge [variant]="statusVariant(token.status)">
                      {{ statusLabel(token.status) }}
                    </ui-badge>
                  </td>
                  <td class="text-muted-foreground px-4 py-3">
                    {{ formatDate(token.createdAt) }}
                  </td>
                  <td class="text-muted-foreground px-4 py-3">
                    {{
                      token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never'
                    }}
                  </td>
                  <td class="text-muted-foreground px-4 py-3">
                    {{
                      token.expiresAt ? formatDate(token.expiresAt) : 'Never'
                    }}
                  </td>
                  <td class="px-4 py-3">
                    @if (confirming()?.id === token.id) {
                      <div class="flex items-center justify-end gap-2">
                        <span class="text-xs font-medium">
                          {{
                            confirming()?.action === 'revoke'
                              ? 'Revoke?'
                              : 'Delete?'
                          }}
                        </span>
                        <ui-button
                          type="button"
                          size="sm"
                          variant="destructive"
                          [disabled]="actingOnId() === token.id"
                          (click)="confirmAction(token)"
                        >
                          Confirm
                        </ui-button>
                        <ui-button
                          type="button"
                          size="sm"
                          variant="outline"
                          [disabled]="actingOnId() === token.id"
                          (click)="cancelConfirm()"
                        >
                          Cancel
                        </ui-button>
                      </div>
                    } @else {
                      <div class="flex items-center justify-end gap-2">
                        @if (token.status === 'active') {
                          <ui-button
                            type="button"
                            size="sm"
                            variant="outline"
                            (click)="requestConfirm(token, 'revoke')"
                          >
                            Revoke
                          </ui-button>
                        }
                        <ui-button
                          type="button"
                          size="sm"
                          variant="destructive"
                          (click)="requestConfirm(token, 'delete')"
                        >
                          Delete
                        </ui-button>
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (actionError()) {
        <ui-error class="mt-3">{{ actionError() }}</ui-error>
      }
    }

    <ng-template #createTokenDrawer>
      <div uiDrawerOverlay></div>
      <section uiDrawerContent side="right" class="flex flex-col p-5">
        <div class="flex items-start justify-between gap-4">
          <h2 uiDrawerTitle>
            {{ createdSecret() ? 'Token created' : 'New access token' }}
          </h2>
          <ui-drawer-close (click)="resetCreateState()">
            <lmn-x-mark aria-hidden="true" [size]="16" />
          </ui-drawer-close>
        </div>

        @if (createdSecret(); as secret) {
          <div class="mt-6 flex flex-col gap-4">
            <p class="text-muted-foreground text-sm">
              Copy this token now. You will not be able to view it again.
            </p>
            <div
              class="border-border bg-muted rounded-lg border p-3 text-xs break-all select-all"
            >
              {{ secret }}
            </div>
            <ui-button type="button" class="gap-2" (click)="copySecret()">
              <lmn-copy slot="leading" aria-hidden="true" [size]="16" />
              {{ copied() ? 'Copied!' : 'Copy' }}
            </ui-button>
            <p class="text-muted-foreground text-xs">
              Store it as <code>GLOSSA_TOKEN</code> in the agent's or CI's
              secret storage — it is never shown again after you close this
              panel.
            </p>
          </div>
        } @else {
          <form
            class="mt-6 flex flex-1 flex-col gap-5"
            (submit)="submitCreate($event)"
            novalidate
          >
            <ui-form-field>
              <ui-label
                htmlFor="token-name"
                [error]="createSubmitted() && !tokenName().trim()"
              >
                Name
              </ui-label>
              <ui-input
                id="token-name"
                [value]="tokenName()"
                (valueChange)="tokenName.set($event)"
                placeholder="Volt UI — CI"
                autocomplete="off"
                required
              />
              @if (createSubmitted() && !tokenName().trim()) {
                <ui-error>A name is required.</ui-error>
              }
            </ui-form-field>

            <fieldset class="grid gap-3">
              <legend class="text-sm font-medium">Scopes</legend>
              <label class="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  class="border-input mt-0.5 size-4 rounded"
                  [checked]="scopeRead()"
                  [disabled]="scopeWrite()"
                  (change)="onReadChange($any($event.target).checked)"
                />
                <span>
                  Read catalogs
                  <span class="text-muted-foreground block text-xs">
                    Discover the project and read its catalogs.
                  </span>
                </span>
              </label>
              <label class="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  class="border-input mt-0.5 size-4 rounded"
                  [checked]="scopeWrite()"
                  (change)="onWriteChange($any($event.target).checked)"
                />
                <span>
                  Write catalogs
                  <span class="text-muted-foreground block text-xs">
                    Includes read access, plus creating and updating catalog
                    content.
                  </span>
                </span>
              </label>
              @if (createSubmitted() && !scopeRead() && !scopeWrite()) {
                <ui-error>At least one scope is required.</ui-error>
              }
            </fieldset>

            <ui-form-field>
              <ui-label htmlFor="token-expires">Expiration</ui-label>
              <ui-input
                id="token-expires"
                type="date"
                [value]="tokenExpiresAt()"
                (valueChange)="tokenExpiresAt.set($event)"
              />
              <ui-hint
                >Optional. Leave blank for a token that never expires.</ui-hint
              >
            </ui-form-field>

            @if (createError()) {
              <ui-error>{{ createError() }}</ui-error>
            }

            <div class="mt-auto flex justify-end pt-4">
              <ui-button type="submit" [disabled]="creating()">
                {{ creating() ? 'Creating...' : 'Create token' }}
              </ui-button>
            </div>
          </form>
        }
      </section>
    </ng-template>
  `,
})
export class AccessTokensPanel {
  readonly projectSlug = input.required<string>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthClient);

  protected readonly isAdmin = computed(
    () => this.auth.user()?.role === 'admin',
  );

  protected readonly tokens = signal<ProjectAccessToken[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');

  protected readonly tokenName = signal('');
  protected readonly scopeRead = signal(true);
  protected readonly scopeWrite = signal(false);
  protected readonly tokenExpiresAt = signal('');
  protected readonly createSubmitted = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal('');
  protected readonly createdSecret = signal<string | null>(null);
  protected readonly copied = signal(false);

  protected readonly confirming = signal<{
    id: string;
    action: 'revoke' | 'delete';
  } | null>(null);
  protected readonly actingOnId = signal<string | null>(null);
  protected readonly actionError = signal('');

  constructor() {
    // Browser-only: this panel nests inside a conditionally-rendered ancestor
    // (`@else if (project(); as project)`), so its constructor only runs once that ancestor's own
    // async load resolves. SSR's pending-request tracking does not reliably wait for HTTP calls
    // started that late in a cascading render, and aborts them once the page is otherwise stable —
    // `afterNextRender` (browser-platforms-only by contract) sidesteps that entirely by deferring
    // the fetch to the real client render.
    afterNextRender(() => void this.load());
  }

  protected async load(): Promise<void> {
    if (!this.isAdmin()) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.loadError.set('');

    try {
      const response = await firstValueFrom(
        this.http.get<{ tokens: ProjectAccessToken[] }>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/tokens`,
        ),
      );
      this.tokens.set(response.tokens);
    } catch {
      this.loadError.set('Access tokens could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }

  protected openCreateDrawer(): void {
    this.resetCreateState();
  }

  protected resetCreateState(): void {
    this.tokenName.set('');
    this.scopeRead.set(true);
    this.scopeWrite.set(false);
    this.tokenExpiresAt.set('');
    this.createSubmitted.set(false);
    this.createError.set('');
    this.createdSecret.set(null);
    this.copied.set(false);
  }

  protected onReadChange(checked: boolean): void {
    // Write implies read — unchecking read while write is on would be a contradiction, so read
    // stays locked on whenever write is selected (the checkbox is disabled in that state).
    this.scopeRead.set(checked || this.scopeWrite());
  }

  protected onWriteChange(checked: boolean): void {
    this.scopeWrite.set(checked);

    if (checked) {
      this.scopeRead.set(true);
    }
  }

  protected async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    this.createSubmitted.set(true);
    this.createError.set('');

    if (!this.tokenName().trim() || (!this.scopeRead() && !this.scopeWrite())) {
      return;
    }

    const scopes: ProjectTokenScope[] = this.scopeWrite()
      ? ['catalog:read', 'catalog:write']
      : ['catalog:read'];

    this.creating.set(true);

    try {
      const response = await firstValueFrom(
        this.http.post<{ token: ProjectAccessToken; secret: string }>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}/tokens`,
          {
            name: this.tokenName().trim(),
            scopes,
            ...(this.tokenExpiresAt()
              ? { expiresAt: this.tokenExpiresAt() }
              : {}),
          },
        ),
      );

      this.createdSecret.set(response.secret);
      this.tokens.update((tokens) => [...tokens, response.token]);
    } catch (error) {
      this.createError.set(
        readTokenError(error, 'Token could not be created.'),
      );
    } finally {
      this.creating.set(false);
    }
  }

  protected async copySecret(): Promise<void> {
    const secret = this.createdSecret();

    if (!secret) {
      return;
    }

    try {
      await navigator.clipboard.writeText(secret);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard API unavailable or denied — the secret text stays visible and selectable.
    }
  }

  protected requestConfirm(
    token: ProjectAccessToken,
    action: 'revoke' | 'delete',
  ): void {
    this.actionError.set('');
    this.confirming.set({ id: token.id, action });
  }

  protected cancelConfirm(): void {
    this.confirming.set(null);
  }

  protected async confirmAction(token: ProjectAccessToken): Promise<void> {
    const pending = this.confirming();

    if (!pending || pending.id !== token.id) {
      return;
    }

    this.actingOnId.set(token.id);
    this.actionError.set('');

    try {
      if (pending.action === 'revoke') {
        const response = await firstValueFrom(
          this.http.post<{ token: ProjectAccessToken }>(
            `/api/projects/${encodeURIComponent(this.projectSlug())}/tokens/${encodeURIComponent(token.id)}/revoke`,
            {},
          ),
        );
        this.tokens.update((tokens) =>
          tokens.map((item) => (item.id === token.id ? response.token : item)),
        );
      } else {
        await firstValueFrom(
          this.http.delete(
            `/api/projects/${encodeURIComponent(this.projectSlug())}/tokens/${encodeURIComponent(token.id)}`,
          ),
        );
        this.tokens.update((tokens) =>
          tokens.filter((item) => item.id !== token.id),
        );
      }

      this.confirming.set(null);
    } catch (error) {
      this.actionError.set(
        readTokenError(
          error,
          pending.action === 'revoke'
            ? 'Token could not be revoked.'
            : 'Token could not be deleted.',
        ),
      );
    } finally {
      this.actingOnId.set(null);
    }
  }

  protected statusVariant(
    status: ProjectTokenStatus,
  ): NonNullable<BadgeVariants['variant']> {
    return STATUS_BADGE_VARIANT[status];
  }

  protected statusLabel(status: ProjectTokenStatus): string {
    return STATUS_LABEL[status];
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}

function readTokenError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
