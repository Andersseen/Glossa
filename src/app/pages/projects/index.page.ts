import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnFolderIcon } from 'lumen-icons/folder';
import { LmnPlusIcon } from 'lumen-icons/plus';
import { firstValueFrom } from 'rxjs';

import { AuthClient } from '../../auth/auth-client';
import { AppShell } from '../../layout/app-shell';
import { EmptyState } from '../../layout/empty-state';
import { PageHeader } from '../../layout/page-header';
import { UiBadge } from '../../ui/badge';
import { buttonVariants } from '../../ui/button/variants';
import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../ui/card';
import { UiSkeleton } from '../../ui/skeleton';

type Project = {
  id: string;
  name: string;
  slug: string;
  sourceLocale: string;
  locales: string[];
};

@Component({
  selector: 'app-projects-index',
  imports: [
    AppShell,
    EmptyState,
    PageHeader,
    RouterLink,
    UiBadge,
    LmnFolderIcon,
    LmnPlusIcon,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    UiSkeleton,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-shell>
      <app-page-header
        title="Projects"
        description="Manage translation catalogs across your applications."
      >
        @if (canWrite()) {
          <a routerLink="/projects/new" [class]="newProjectClass">
            <lmn-plus aria-hidden="true" [size]="16" />
            New project
          </a>
        }
      </app-page-header>

      <div class="mt-10" [move]="'fade-up'">
        @if (loading()) {
          <div class="grid gap-4 sm:grid-cols-2" aria-label="Loading projects">
            <ui-card>
              <ui-card-header>
                <ui-skeleton height="1.25rem" width="45%" />
                <ui-skeleton height="1rem" width="35%" />
              </ui-card-header>
              <ui-card-content class="grid gap-3">
                <ui-skeleton height="1rem" width="60%" />
                <ui-skeleton height="1.5rem" width="75%" />
              </ui-card-content>
            </ui-card>
            <ui-card class="hidden sm:block">
              <ui-card-header>
                <ui-skeleton height="1.25rem" width="50%" />
                <ui-skeleton height="1rem" width="40%" />
              </ui-card-header>
              <ui-card-content class="grid gap-3">
                <ui-skeleton height="1rem" width="55%" />
                <ui-skeleton height="1.5rem" width="70%" />
              </ui-card-content>
            </ui-card>
          </div>
        } @else if (error()) {
          <p class="text-destructive text-sm">{{ error() }}</p>
        } @else if (projects().length === 0) {
          <app-empty-state
            title="No projects yet"
            description="Create the first managed project to start defining locales."
          >
            <lmn-folder
              slot="icon"
              class="text-muted-foreground"
              aria-hidden="true"
            />
            @if (canWrite()) {
              <a routerLink="/projects/new" [class]="emptyActionClass">
                New project
              </a>
            }
          </app-empty-state>
        } @else {
          <div class="grid gap-4 sm:grid-cols-2">
            @for (project of projects(); track project.id) {
              <a
                [routerLink]="['/projects', project.slug]"
                class="focus-visible:ring-ring rounded-lg outline-none focus-visible:ring-2"
              >
                <ui-card
                  class="hover:border-primary/60 h-full rounded-lg transition hover:shadow-md"
                >
                  <ui-card-header>
                    <ui-card-title>{{ project.name }}</ui-card-title>
                    <ui-card-description>
                      {{ project.slug }}
                    </ui-card-description>
                  </ui-card-header>
                  <ui-card-content class="grid gap-4">
                    <dl
                      class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
                    >
                      <dt class="text-muted-foreground">Source</dt>
                      <dd class="font-medium">{{ project.sourceLocale }}</dd>
                      <dt class="text-muted-foreground">Locales</dt>
                      <dd class="flex flex-wrap gap-1.5">
                        @for (locale of project.locales; track locale) {
                          <ui-badge variant="secondary">{{ locale }}</ui-badge>
                        }
                      </dd>
                    </dl>
                  </ui-card-content>
                </ui-card>
              </a>
            }
          </div>
        }
      </div>
    </app-shell>
  `,
})
export default class ProjectsIndexPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthClient);
  private readonly router = inject(Router);

  protected readonly newProjectClass = buttonVariants({ variant: 'solid' });
  protected readonly emptyActionClass = buttonVariants({ variant: 'outline' });
  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly canWrite = computed(() =>
    ['admin', 'editor'].includes(this.auth.user()?.role ?? ''),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const user = await this.auth.loadCurrentUser();

    if (!user) {
      await this.router.navigate(['/signin'], {
        queryParams: { redirect: '/projects' },
      });
      return;
    }

    await this.loadProjects();
  }

  private async loadProjects(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ projects: Project[] }>('/api/projects'),
      );
      this.projects.set(response.projects);
    } catch {
      this.error.set('Projects could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}
