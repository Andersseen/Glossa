import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnFolderIcon } from 'lumen-icons/folder';
import { LmnPlusIcon } from 'lumen-icons/plus';
import { firstValueFrom } from 'rxjs';

import {
  UiCard,
  UiCardContent,
  UiCardDescription,
  UiCardHeader,
  UiCardTitle,
} from '../../ui/card';

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
    RouterLink,
    LmnFolderIcon,
    LmnPlusIcon,
    UiCard,
    UiCardContent,
    UiCardDescription,
    UiCardHeader,
    UiCardTitle,
    ...MOVEMENT_DIRECTIVES,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="bg-background text-foreground min-h-screen">
      <section class="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8 lg:px-10">
        <header
          class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <a class="text-muted-foreground text-sm font-medium" routerLink="/">
              Glossa
            </a>
            <h1 class="mt-5 text-3xl font-semibold tracking-normal">
              Projects
            </h1>
            <p class="text-muted-foreground mt-3 max-w-2xl text-base leading-7">
              Manage the translation projects Glossa will serve through
              ForgeCMS.
            </p>
          </div>

          <a
            routerLink="/projects/new"
            class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium shadow-sm transition outline-none focus-visible:ring-2"
          >
            <lmn-plus aria-hidden="true" [size]="16" />
            New project
          </a>
        </header>

        <div class="mt-10" [move]="'fade-up'">
          @if (loading()) {
            <p class="text-muted-foreground text-sm">Loading projects...</p>
          } @else if (error()) {
            <p class="text-destructive text-sm">{{ error() }}</p>
          } @else if (projects().length === 0) {
            <ui-card>
              <ui-card-content class="grid justify-items-start gap-4 pt-6">
                <lmn-folder class="text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 class="text-base font-semibold">No projects yet</h2>
                  <p class="text-muted-foreground mt-2 text-sm leading-6">
                    Create the first managed project to start defining locales.
                  </p>
                </div>
                <a
                  routerLink="/projects/new"
                  class="border-border bg-card hover:bg-muted focus-visible:ring-ring inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition outline-none focus-visible:ring-2"
                >
                  New project
                </a>
              </ui-card-content>
            </ui-card>
          } @else {
            <div class="grid gap-4 sm:grid-cols-2">
              @for (project of projects(); track project.id) {
                <a [routerLink]="['/projects', project.slug]">
                  <ui-card
                    class="hover:border-primary/60 h-full transition hover:shadow-md"
                  >
                    <ui-card-header>
                      <ui-card-title>{{ project.name }}</ui-card-title>
                      <ui-card-description>
                        Source: {{ project.sourceLocale }}
                      </ui-card-description>
                    </ui-card-header>
                    <ui-card-content>
                      <p class="text-muted-foreground text-sm">
                        Locales:
                        <span class="text-foreground">
                          {{ project.locales.join(' · ') }}
                        </span>
                      </p>
                    </ui-card-content>
                  </ui-card>
                </a>
              }
            </div>
          }
        </div>
      </section>
    </main>
  `,
})
export default class ProjectsIndexPage {
  private readonly http = inject(HttpClient);

  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    void this.loadProjects();
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
