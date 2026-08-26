import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { firstValueFrom } from 'rxjs';

import { AppShell } from '../../layout/app-shell';
import { PageHeader } from '../../layout/page-header';
import { UiBadge } from '../../ui/badge';
import {
  UiBreadcrumbItem,
  UiBreadcrumbLink,
  UiBreadcrumbList,
  UiBreadcrumbPage,
  UiBreadcrumbSeparator,
  UiBreadcrumbs,
} from '../../ui/breadcrumbs';
import { UiButton } from '../../ui/button';
import { buttonVariants } from '../../ui/button/variants';
import { UiCard, UiCardContent } from '../../ui/card';
import { UiError, UiFormField, UiLabel } from '../../ui/form-field';
import { UiSkeleton } from '../../ui/skeleton';
import { UiTextarea } from '../../ui/textarea';

type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
};

type Catalog = {
  locale: string;
  namespace: string;
  content: Record<string, unknown>;
};

@Component({
  selector: 'app-catalog-editor',
  imports: [
    AppShell,
    PageHeader,
    RouterLink,
    UiBadge,
    UiBreadcrumbItem,
    UiBreadcrumbLink,
    UiBreadcrumbList,
    UiBreadcrumbPage,
    UiBreadcrumbSeparator,
    UiBreadcrumbs,
    UiButton,
    UiCard,
    UiCardContent,
    UiError,
    UiFormField,
    UiLabel,
    UiSkeleton,
    UiTextarea,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (loading()) {
        <div class="grid max-w-4xl gap-8" aria-label="Loading catalog">
          <ui-skeleton width="14rem" height="1rem" />
          <ui-skeleton width="18rem" height="2rem" />
          <ui-skeleton width="100%" height="16rem" />
        </div>
      } @else if (loadError()) {
        <p class="text-destructive mt-10 text-sm">{{ loadError() }}</p>
      } @else if (project(); as project) {
        <ui-breadcrumbs>
          <ui-breadcrumb-list>
            <ui-breadcrumb-item>
              <ui-breadcrumb-link href="/projects">Projects</ui-breadcrumb-link>
            </ui-breadcrumb-item>
            <ui-breadcrumb-separator />
            <ui-breadcrumb-item>
              <ui-breadcrumb-link [href]="'/projects/' + project.slug">
                {{ project.name }}
              </ui-breadcrumb-link>
            </ui-breadcrumb-item>
            <ui-breadcrumb-separator />
            <ui-breadcrumb-item>
              <ui-breadcrumb-page>{{ locale }}.json</ui-breadcrumb-page>
            </ui-breadcrumb-item>
          </ui-breadcrumb-list>
        </ui-breadcrumbs>

        <app-page-header
          class="mt-8"
          [title]="locale + '.json'"
          description="Edit this locale's translation catalog as JSON."
          [move]="'fade-up'"
        >
          <p slot="meta" class="mt-2 flex flex-wrap gap-2">
            @if (locale === project.sourceLocale) {
              <ui-badge variant="outline">Source locale</ui-badge>
            }
            @if (catalogExists()) {
              <ui-badge variant="solid">Ready</ui-badge>
            } @else {
              <ui-badge variant="secondary">Not created</ui-badge>
            }
          </p>
        </app-page-header>

        <ui-card class="mt-8" [move]="'fade-up'">
          <ui-card-content class="grid gap-4 pt-6">
            <ui-form-field>
              <ui-label htmlFor="catalog-editor" [error]="!!saveError()">
                Catalog JSON
              </ui-label>
              <ui-textarea
                id="catalog-editor"
                [value]="editorText()"
                (valueChange)="editorText.set($event)"
                [rows]="18"
                spellcheck="false"
                [ariaDescribedBy]="saveError() ? 'catalog-editor-error' : ''"
              />
              @if (saveError()) {
                <ui-error id="catalog-editor-error">{{ saveError() }}</ui-error>
              }
            </ui-form-field>

            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="text-muted-foreground text-sm" aria-live="polite">
                @if (saving()) {
                  Saving...
                } @else if (justSaved()) {
                  Saved
                }
              </p>
              <div class="flex gap-3">
                <a
                  [routerLink]="['/projects', project.slug]"
                  [class]="cancelLinkClass"
                >
                  Back to project
                </a>
                <ui-button type="button" [disabled]="saving()" (click)="save()">
                  {{ saving() ? 'Saving...' : 'Save' }}
                </ui-button>
              </div>
            </div>
          </ui-card-content>
        </ui-card>

        @if (catalogExists()) {
          <ui-card class="border-destructive/40 mt-6" [move]="'fade-up'">
            <ui-card-content class="grid gap-4 pt-6">
              <div>
                <h2 class="text-sm font-semibold">Delete this catalog</h2>
                <p class="text-muted-foreground mt-1 text-sm">
                  Removes the stored {{ locale }}.json catalog for this project.
                  This cannot be undone.
                </p>
              </div>
              @if (deleteError()) {
                <ui-error>{{ deleteError() }}</ui-error>
              }
              <div>
                @if (confirmingDelete()) {
                  <div class="flex flex-wrap items-center gap-3">
                    <span class="text-sm font-medium"
                      >Delete {{ locale }}.json?</span
                    >
                    <ui-button
                      type="button"
                      variant="destructive"
                      [disabled]="deleting()"
                      (click)="confirmDelete()"
                    >
                      {{ deleting() ? 'Deleting...' : 'Confirm delete' }}
                    </ui-button>
                    <ui-button
                      type="button"
                      variant="outline"
                      [disabled]="deleting()"
                      (click)="cancelDelete()"
                    >
                      Cancel
                    </ui-button>
                  </div>
                } @else {
                  <ui-button
                    type="button"
                    variant="destructive"
                    (click)="confirmingDelete.set(true)"
                  >
                    Delete catalog
                  </ui-button>
                }
              </div>
            </ui-card-content>
          </ui-card>
        }
      }
    </app-shell>
  `,
})
export default class CatalogEditorPage {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly slug = this.route.snapshot.paramMap.get('slug') ?? '';
  protected readonly locale = this.route.snapshot.paramMap.get('locale') ?? '';

  protected readonly cancelLinkClass = buttonVariants({
    variant: 'outline',
    size: 'md',
  });

  protected readonly project = signal<Project | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal('');
  protected readonly catalogExists = signal(false);
  protected readonly editorText = signal('{}');

  protected readonly saving = signal(false);
  protected readonly saveError = signal('');
  protected readonly justSaved = signal(false);

  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal('');

  constructor() {
    void this.load();
  }

  protected async save(): Promise<void> {
    this.saveError.set('');
    this.justSaved.set(false);

    let content: unknown;

    try {
      content = JSON.parse(this.editorText());
    } catch {
      this.saveError.set('Invalid JSON');
      return;
    }

    this.saving.set(true);

    try {
      const response = await firstValueFrom(
        this.http.put<{ catalog: Catalog }>(
          `/api/projects/${encodeURIComponent(this.slug)}/catalogs/${encodeURIComponent(this.locale)}`,
          { content },
        ),
      );

      this.editorText.set(JSON.stringify(response.catalog.content, null, 2));
      this.catalogExists.set(true);
      this.justSaved.set(true);
      setTimeout(() => this.justSaved.set(false), 2000);
    } catch (error) {
      this.saveError.set(
        readCatalogError(error, 'Catalog could not be saved.'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
    this.deleteError.set('');
  }

  protected async confirmDelete(): Promise<void> {
    this.deleteError.set('');
    this.deleting.set(true);

    try {
      await firstValueFrom(
        this.http.delete(
          `/api/projects/${encodeURIComponent(this.slug)}/catalogs/${encodeURIComponent(this.locale)}`,
        ),
      );
      await this.router.navigate(['/projects', this.slug]);
    } catch (error) {
      this.deleteError.set(
        readCatalogError(error, 'Catalog could not be deleted.'),
      );
      this.confirmingDelete.set(false);
    } finally {
      this.deleting.set(false);
    }
  }

  private async load(): Promise<void> {
    if (!this.slug || !this.locale) {
      this.loadError.set('Project or locale is missing.');
      this.loading.set(false);
      return;
    }

    try {
      const projectResponse = await firstValueFrom(
        this.http.get<{ project: Project }>(
          `/api/projects/${encodeURIComponent(this.slug)}`,
        ),
      );
      this.project.set(projectResponse.project);

      try {
        const catalogResponse = await firstValueFrom(
          this.http.get<{ catalog: Catalog }>(
            `/api/projects/${encodeURIComponent(this.slug)}/catalogs/${encodeURIComponent(this.locale)}`,
          ),
        );
        this.catalogExists.set(true);
        this.editorText.set(
          JSON.stringify(catalogResponse.catalog.content, null, 2),
        );
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          this.catalogExists.set(false);
          this.editorText.set('{}');
        } else {
          throw error;
        }
      }
    } catch {
      this.loadError.set('Project could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}

function readCatalogError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
