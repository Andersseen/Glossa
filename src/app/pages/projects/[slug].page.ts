import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MOVEMENT_DIRECTIVES } from 'angular-movement';
import { LmnArrowLeftIcon } from 'lumen-icons/arrow-left';
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
  selector: 'app-project-detail',
  imports: [
    RouterLink,
    LmnArrowLeftIcon,
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
      <section class="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 lg:px-10">
        <a
          routerLink="/projects"
          class="text-muted-foreground hover:text-foreground inline-flex items-center gap-2 text-sm font-medium transition"
        >
          <lmn-arrow-left aria-hidden="true" [size]="16" />
          Projects
        </a>

        @if (loading()) {
          <p class="text-muted-foreground mt-10 text-sm">Loading project...</p>
        } @else if (error()) {
          <p class="text-destructive mt-10 text-sm">{{ error() }}</p>
        } @else if (project(); as project) {
          <header class="mt-8" [move]="'fade-up'">
            <p class="text-muted-foreground text-sm">{{ project.slug }}</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-normal">
              {{ project.name }}
            </h1>
          </header>

          <div class="mt-10 grid gap-6">
            <ui-card [move]="'fade-up'">
              <ui-card-header>
                <ui-card-title>{{ project.name }}</ui-card-title>
                <ui-card-description
                  >Project locale settings</ui-card-description
                >
              </ui-card-header>
              <ui-card-content>
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
                        <span
                          class="border-border bg-muted inline-flex rounded-md border px-2.5 py-1 text-sm font-medium"
                        >
                          {{ locale }}
                        </span>
                      }
                    </dd>
                  </div>
                </dl>
              </ui-card-content>
            </ui-card>

            <section>
              <h2 class="text-xl font-semibold">Catalogs</h2>
              <p class="text-muted-foreground mt-3 text-sm">No catalogs yet.</p>
              <p class="text-muted-foreground mt-1 text-sm">
                Catalog management will be implemented next.
              </p>
            </section>
          </div>
        }
      </section>
    </main>
  `,
})
export default class ProjectDetailPage {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  protected readonly project = signal<Project | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    void this.loadProject();
  }

  private async loadProject(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get('slug');

    if (!slug) {
      this.error.set('Project slug is missing.');
      this.loading.set(false);
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<{ project: Project }>(
          `/api/projects/${encodeURIComponent(slug)}`,
        ),
      );
      this.project.set(response.project);
    } catch {
      this.error.set('Project could not be loaded.');
    } finally {
      this.loading.set(false);
    }
  }
}
