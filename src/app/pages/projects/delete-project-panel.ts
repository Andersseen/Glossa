import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthClient } from '../../auth/auth-client';
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
import { UiError, UiFormField, UiLabel } from '../../ui/form-field';
import { UiInput } from '../../ui/input';
import type { Project, ProjectDeletionImpact } from './project.types';

/**
 * The Settings tab's "Danger zone": whole-project deletion behind an admin-only, typed-slug
 * confirmation. Self-contained like the key rename/delete panels — it owns its drawer, its
 * requests and its error state. The server is the authority on who may delete (admin only); the
 * `isAdmin` check here only decides whether to offer the button at all.
 *
 * Reuses the existing drawer as the confirmation dialog (an `alertdialog`, titled, with its
 * description wired by ng-primitives) rather than introducing a second modal primitive.
 */
@Component({
  selector: 'app-delete-project-panel',
  imports: [
    UiButton,
    UiDrawer,
    UiDrawerClose,
    UiDrawerContent,
    UiDrawerDescription,
    UiDrawerOverlay,
    UiDrawerTitle,
    UiError,
    UiFormField,
    UiInput,
    UiLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border-destructive/40 mt-12 max-w-3xl rounded-lg border p-5"
      aria-labelledby="danger-zone-heading"
    >
      <h2
        id="danger-zone-heading"
        class="text-destructive text-xl font-semibold"
      >
        Danger zone
      </h2>

      <div class="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div class="max-w-lg">
          <h3 class="text-sm font-semibold">Delete project</h3>
          <p class="text-muted-foreground mt-1 text-sm">
            Permanently delete this project and all of its translation catalogs.
            Project access tokens will stop working. Public delivery URLs will
            stop serving this project.
          </p>
        </div>

        @if (isAdmin()) {
          <button
            type="button"
            [uiDrawer]="deleteDrawer"
            (click)="open()"
            class="border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium outline-none focus-visible:ring-2"
          >
            Delete project
          </button>
        }
      </div>

      @if (!isAdmin()) {
        <p class="text-muted-foreground mt-4 text-sm">
          Only project admins can delete a project.
        </p>
      }
    </section>

    <ng-template #deleteDrawer let-close="close">
      <div uiDrawerOverlay></div>
      <section
        uiDrawerContent
        side="right"
        role="alertdialog"
        class="flex w-[460px] max-w-[92vw] flex-col p-5"
      >
        <h2 uiDrawerTitle>Delete project {{ project().slug }}?</h2>
        <p uiDrawerDescription class="mt-2">
          This permanently deletes the project and all of its translation
          catalogs. It cannot be undone.
        </p>

        <div class="mt-6 flex flex-1 flex-col gap-5 overflow-y-auto">
          @if (impact(); as impact) {
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt class="text-muted-foreground">Project</dt>
              <dd class="font-medium">{{ impact.project.slug }}</dd>
              <dt class="text-muted-foreground">Catalogs</dt>
              <dd class="font-medium">
                {{ impact.catalogs }}
                @if (impact.catalogLocales.length > 0) {
                  <span class="text-muted-foreground font-normal">
                    ({{ impact.catalogLocales.join(', ') }})
                  </span>
                }
              </dd>
              <dt class="text-muted-foreground">Locales</dt>
              <dd class="font-medium">{{ impact.locales.join(', ') }}</dd>
              <dt class="text-muted-foreground">Access tokens</dt>
              <dd class="font-medium">
                {{ impact.accessTokens.active }} active
                @if (impact.accessTokens.total > impact.accessTokens.active) {
                  <span class="text-muted-foreground font-normal">
                    ({{ impact.accessTokens.total }} total)
                  </span>
                }
              </dd>
              <dt class="text-muted-foreground">Public delivery</dt>
              <dd class="font-medium">
                {{ impact.publicDelivery ? 'Enabled' : 'Disabled' }}
              </dd>
            </dl>
          } @else if (loadingImpact()) {
            <p class="text-muted-foreground text-sm" role="status">
              Loading what this project contains…
            </p>
          } @else if (impactError()) {
            <ui-error>{{ impactError() }}</ui-error>
          }

          <ui-form-field>
            <ui-label htmlFor="delete-project-confirmation">
              Type "{{ project().slug }}" to confirm:
            </ui-label>
            <ui-input
              id="delete-project-confirmation"
              [value]="confirmation()"
              (valueChange)="confirmation.set($event)"
              autocomplete="off"
              [ariaDescribedBy]="error() ? 'delete-project-error' : ''"
            />
          </ui-form-field>

          @if (error()) {
            <ui-error id="delete-project-error">{{ error() }}</ui-error>
          }

          <div class="flex justify-end gap-3">
            <ui-drawer-close
              srLabel=""
              [class]="cancelButtonClass"
              (click)="resetState()"
            >
              Cancel
            </ui-drawer-close>
            <ui-button
              type="button"
              variant="destructive"
              [disabled]="!canDelete()"
              (click)="submit(close)"
            >
              {{ deleting() ? 'Deleting...' : 'Delete permanently' }}
            </ui-button>
          </div>
        </div>
      </section>
    </ng-template>
  `,
})
export class DeleteProjectPanel {
  readonly project = input.required<Project>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthClient);
  private readonly router = inject(Router);

  protected readonly cancelButtonClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly isAdmin = computed(
    () => this.auth.user()?.role === 'admin',
  );

  protected readonly impact = signal<ProjectDeletionImpact | null>(null);
  protected readonly loadingImpact = signal(false);
  protected readonly impactError = signal('');
  protected readonly confirmation = signal('');
  protected readonly deleting = signal(false);
  protected readonly error = signal('');

  /** Deletion stays disabled until the facts are on screen and the exact slug has been typed. */
  protected readonly canDelete = computed(
    () =>
      this.impact() !== null &&
      this.confirmation().trim() === this.project().slug &&
      !this.deleting(),
  );

  /** Every open starts clean and re-reads the facts, so a dialog never shows a stale summary or a typed slug. */
  protected open(): void {
    this.resetState();
    void this.loadImpact();
  }

  protected resetState(): void {
    this.confirmation.set('');
    this.error.set('');
    this.deleting.set(false);
    this.impact.set(null);
    this.impactError.set('');
  }

  protected async submit(close: () => void): Promise<void> {
    if (!this.canDelete()) {
      return;
    }

    const slug = this.project().slug;
    this.deleting.set(true);
    this.error.set('');

    try {
      await firstValueFrom(
        this.http.delete(`/api/projects/${encodeURIComponent(slug)}`),
      );

      close();
      await this.router.navigate(['/projects'], {
        queryParams: { deleted: slug },
      });
    } catch (error) {
      this.error.set(
        readDeleteError(error, 'The project could not be deleted.'),
      );
    } finally {
      this.deleting.set(false);
    }
  }

  private async loadImpact(): Promise<void> {
    this.loadingImpact.set(true);

    try {
      const response = await firstValueFrom(
        this.http.get<{ impact: ProjectDeletionImpact }>(
          `/api/projects/${encodeURIComponent(this.project().slug)}/deletion-impact`,
        ),
      );
      this.impact.set(response.impact);
    } catch (error) {
      this.impactError.set(
        readDeleteError(
          error,
          'What this project contains could not be loaded. Close this dialog and try again.',
        ),
      );
    } finally {
      this.loadingImpact.set(false);
    }
  }
}

function readDeleteError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
