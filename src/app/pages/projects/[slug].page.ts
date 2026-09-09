import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnDocumentTextIcon } from 'lumen-icons/document-text';
import { firstValueFrom } from 'rxjs';

import { AuthClient } from '../../auth/auth-client';
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
import { UiCard, UiCardContent } from '../../ui/card';
import { UiSeparator } from '../../ui/separator';
import {
  UiTabs,
  UiTabsContent,
  UiTabsList,
  UiTabsTrigger,
} from '../../ui/tabs';
import { UiSkeleton } from '../../ui/skeleton';

type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
};

type Catalog = {
  locale: string;
};

@Component({
  selector: 'app-project-detail',
  imports: [
    AppShell,
    PageHeader,
    RouterLink,
    LmnDocumentTextIcon,
    UiBadge,
    UiBreadcrumbItem,
    UiBreadcrumbLink,
    UiBreadcrumbList,
    UiBreadcrumbPage,
    UiBreadcrumbSeparator,
    UiBreadcrumbs,
    UiCard,
    UiCardContent,
    UiSeparator,
    UiSkeleton,
    UiTabs,
    UiTabsContent,
    UiTabsList,
    UiTabsTrigger,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      @if (loading()) {
        <div class="grid max-w-4xl gap-8" aria-label="Loading project">
          <ui-skeleton width="14rem" height="1rem" />
          <div class="grid gap-3">
            <ui-skeleton width="9rem" height="1rem" />
            <ui-skeleton width="18rem" height="2rem" />
          </div>
          <ui-card>
            <ui-card-content class="grid gap-5 pt-6">
              <ui-skeleton width="11rem" height="1.25rem" />
              <ui-skeleton width="100%" height="1px" />
              <ui-skeleton width="60%" height="1.25rem" />
              <ui-skeleton width="75%" height="1.25rem" />
            </ui-card-content>
          </ui-card>
        </div>
      } @else if (error()) {
        <p class="text-destructive mt-10 text-sm">{{ error() }}</p>
      } @else if (project(); as project) {
        <ui-breadcrumbs>
          <ui-breadcrumb-list>
            <ui-breadcrumb-item>
              <ui-breadcrumb-link href="/projects">Projects</ui-breadcrumb-link>
            </ui-breadcrumb-item>
            <ui-breadcrumb-separator />
            <ui-breadcrumb-item>
              <ui-breadcrumb-page>{{ project.name }}</ui-breadcrumb-page>
            </ui-breadcrumb-item>
          </ui-breadcrumb-list>
        </ui-breadcrumbs>

        <app-page-header
          class="mt-8"
          [title]="project.name"
          description="Project workspace for locale configuration and catalogs."
          [move]="'fade-up'"
        >
          <p slot="meta" class="text-muted-foreground mt-2 text-sm">
            {{ project.slug }}
          </p>
        </app-page-header>

        <ui-tabs class="mt-10 block" value="overview">
          <ui-tabs-list aria-label="Project sections">
            <ui-tabs-trigger value="overview">Overview</ui-tabs-trigger>
            <ui-tabs-trigger value="translations" disabled>
              Translations
            </ui-tabs-trigger>
            <ui-tabs-trigger value="api" disabled>API</ui-tabs-trigger>
          </ui-tabs-list>

          <ui-tabs-content value="overview" class="mt-8">
            <section [move]="'fade-up'">
              <h2 class="text-xl font-semibold">Overview</h2>
              <ui-separator class="my-4" />
              <dl class="grid gap-6 sm:grid-cols-2">
                <div>
                  <dt class="text-muted-foreground text-sm">Source locale</dt>
                  <dd class="mt-2 text-lg font-semibold">
                    {{ project.sourceLocale }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-sm">Locales</dt>
                  <dd class="mt-2 flex flex-wrap gap-2">
                    @for (locale of project.locales; track locale) {
                      <ui-badge variant="secondary">{{ locale }}</ui-badge>
                    }
                  </dd>
                </div>
              </dl>
            </section>

            <section class="mt-10" [move]="'fade-up'">
              <h2 class="text-xl font-semibold">Catalogs</h2>
              <ui-separator class="my-4" />
              <div class="border-border overflow-hidden rounded-lg border">
                @for (catalog of catalogRows(); track catalog.locale) {
                  <a
                    [routerLink]="[
                      '/projects',
                      project.slug,
                      'catalogs',
                      catalog.locale,
                    ]"
                    class="border-border hover:bg-muted focus-visible:ring-ring grid gap-3 px-4 py-3 text-sm outline-none last:border-b-0 focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[1fr_auto_auto] sm:items-center"
                    [class.border-b]="!$last"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <lmn-document-text
                        class="text-muted-foreground shrink-0"
                        aria-hidden="true"
                        [size]="20"
                      />
                      <span class="font-medium">{{ catalog.fileName }}</span>
                    </div>
                    <div>
                      @if (catalog.source) {
                        <ui-badge variant="outline">Source locale</ui-badge>
                      }
                    </div>
                    @if (catalog.ready) {
                      <ui-badge variant="solid">Ready</ui-badge>
                    } @else {
                      <ui-badge variant="secondary">Not created</ui-badge>
                    }
                  </a>
                }
              </div>
            </section>
          </ui-tabs-content>

          <ui-tabs-content value="translations">
            <p class="text-muted-foreground text-sm">
              Translation workflows are planned for a later branch.
            </p>
          </ui-tabs-content>

          <ui-tabs-content value="api">
            <p class="text-muted-foreground text-sm">
              API access will be designed after catalogs exist.
            </p>
          </ui-tabs-content>
        </ui-tabs>
      }
    </app-shell>
  `,
})
export default class ProjectDetailPage {
  private readonly auth = inject(AuthClient);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly catalogs = signal<Catalog[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly catalogRows = computed(() => {
    const project = this.project();

    if (!project) {
      return [];
    }

    const readyLocales = new Set(
      this.catalogs().map((catalog) => catalog.locale),
    );

    return project.locales.map((locale) => ({
      locale,
      fileName: `${locale}.json`,
      source: locale === project.sourceLocale,
      ready: readyLocales.has(locale),
    }));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const user = await this.auth.loadCurrentUser();

    if (!user) {
      await this.router.navigate(['/signin'], {
        queryParams: { redirect: this.router.url },
      });
      return;
    }

    await this.loadProject();
  }

  private async loadProject(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');

    if (!slug) {
      this.error.set('Project slug is missing.');
      this.loading.set(false);
      return;
    }

    try {
      const [projectResponse, catalogsResponse] = await Promise.all([
        firstValueFrom(
          this.http.get<{ project: Project }>(
            `/api/projects/${encodeURIComponent(slug)}`,
          ),
        ),
        firstValueFrom(
          this.http.get<{ catalogs: Catalog[] }>(
            `/api/projects/${encodeURIComponent(slug)}/catalogs`,
          ),
        ),
      ]);
      this.project.set(projectResponse.project);
      this.catalogs.set(catalogsResponse.catalogs);
    } catch {
      this.error.set('Project could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}
