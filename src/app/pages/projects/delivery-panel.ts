import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LmnArrowTopRightOnSquareIcon } from 'lumen-icons/arrow-top-right-on-square';
import { LmnCopyIcon } from 'lumen-icons/copy';

import { AuthClient } from '../../auth/auth-client';
import { UiBadge } from '../../ui/badge';
import { UiButton } from '../../ui/button';
import { UiError } from '../../ui/form-field';

export type DeliveryProject = {
  slug: string;
  sourceLocale: string;
  locales: string[];
  publicDelivery: boolean;
};

type UrlRow = {
  label: string;
  url: string;
  source: boolean;
};

@Component({
  selector: 'app-delivery-panel',
  imports: [
    UiBadge,
    UiButton,
    UiError,
    LmnArrowTopRightOnSquareIcon,
    LmnCopyIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-start justify-between gap-4">
      <p class="text-muted-foreground max-w-lg text-sm">
        Serve this project's catalogs as public, cacheable JSON — no auth token
        required — so a consuming application can fetch translations directly at
        runtime.
      </p>
    </div>

    @if (!isAdmin()) {
      <p class="text-muted-foreground mt-6 text-sm">
        Only project admins can change delivery settings.
      </p>
    } @else {
      <div class="mt-6 flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            class="border-input size-4 rounded"
            [checked]="project().publicDelivery"
            [disabled]="saving()"
            (change)="onToggle($any($event.target).checked)"
          />
          Public delivery
        </label>
        <ui-badge [variant]="project().publicDelivery ? 'solid' : 'secondary'">
          {{ project().publicDelivery ? 'Enabled' : 'Disabled' }}
        </ui-badge>
      </div>

      @if (toggleError()) {
        <ui-error class="mt-3">{{ toggleError() }}</ui-error>
      }
    }

    <section class="mt-8">
      <h3 class="text-sm font-semibold">Runtime URLs</h3>
      <p class="text-muted-foreground mt-1 text-xs">
        @if (project().publicDelivery) {
          Live now — these return raw JSON with no authentication required.
        } @else {
          Not served until public delivery is enabled above; each URL currently
          returns 404.
        }
      </p>

      <div
        class="border-border mt-3 divide-y overflow-hidden rounded-lg border"
      >
        @for (row of urlRows(); track row.url) {
          <div class="flex items-center justify-between gap-3 px-4 py-3">
            <div class="min-w-0">
              <p class="flex items-center gap-2 text-xs font-medium">
                {{ row.label }}
                @if (row.source) {
                  <ui-badge variant="outline">Source locale</ui-badge>
                }
              </p>
              <code class="text-muted-foreground mt-1 block truncate text-xs">
                {{ row.url }}
              </code>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <ui-button
                type="button"
                size="sm"
                variant="outline"
                (click)="copy(row.url)"
              >
                {{ copiedText() === row.url ? 'Copied!' : 'Copy' }}
              </ui-button>
              <a
                [href]="row.url"
                target="_blank"
                rel="noopener"
                class="border-input hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-2"
              >
                Open
                <lmn-arrow-top-right-on-square aria-hidden="true" [size]="14" />
              </a>
            </div>
          </div>
        }
      </div>
    </section>

    <section class="mt-10">
      <h3 class="text-sm font-semibold">MCP / agent access</h3>
      <p class="text-muted-foreground mt-1 text-xs">
        Point an AI coding agent's MCP client at this endpoint using a project
        access token from Access tokens.
      </p>

      <div
        class="border-border bg-muted mt-3 flex items-center justify-between gap-3 rounded-lg border p-3"
      >
        <code class="truncate text-xs">{{ mcpEndpoint() }}</code>
        <ui-button
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0 gap-2"
          (click)="copy(mcpEndpoint())"
        >
          <lmn-copy slot="leading" aria-hidden="true" [size]="14" />
          {{ copiedText() === mcpEndpoint() ? 'Copied!' : 'Copy' }}
        </ui-button>
      </div>

      <p class="text-muted-foreground mt-4 text-xs">
        Generic reference config — verify the exact syntax for your MCP client.
      </p>
      <div class="border-border bg-muted relative mt-2 rounded-lg border p-3">
        <pre
          class="overflow-x-auto text-xs"
        ><code>{{ mcpConfigExample() }}</code></pre>
      </div>
      <ui-button
        type="button"
        size="sm"
        variant="outline"
        class="mt-2 gap-2"
        (click)="copy(mcpConfigExample())"
      >
        <lmn-copy slot="leading" aria-hidden="true" [size]="14" />
        {{ copiedText() === mcpConfigExample() ? 'Copied!' : 'Copy config' }}
      </ui-button>
    </section>
  `,
})
export class DeliveryPanel {
  readonly projectSlug = input.required<string>();
  readonly project = input.required<DeliveryProject>();
  readonly projectUpdated = output<DeliveryProject>();

  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthClient);

  protected readonly isAdmin = computed(
    () => this.auth.user()?.role === 'admin',
  );
  protected readonly saving = signal(false);
  protected readonly toggleError = signal('');
  protected readonly copiedText = signal<string | null>(null);

  // `location` does not exist during SSR — populated once the real client render runs, matching
  // the same SSR-safety approach `AccessTokensPanel` already uses for its own browser-only work.
  private readonly origin = signal('');

  protected readonly manifestUrl = computed(
    () =>
      `${this.origin()}/i18n/${encodeURIComponent(this.projectSlug())}/manifest.json`,
  );

  protected readonly mcpEndpoint = computed(() => `${this.origin()}/mcp`);

  protected readonly urlRows = computed<UrlRow[]>(() => {
    const project = this.project();
    const slug = encodeURIComponent(this.projectSlug());

    return [
      { label: 'Manifest', url: this.manifestUrl(), source: false },
      ...project.locales.map((locale) => ({
        label: `${locale}.json`,
        url: `${this.origin()}/i18n/${slug}/${locale}.json`,
        source: locale === project.sourceLocale,
      })),
    ];
  });

  protected readonly mcpConfigExample = computed(() =>
    JSON.stringify(
      {
        mcpServers: {
          glossa: {
            url: this.mcpEndpoint(),
            headers: { Authorization: 'Bearer ${GLOSSA_TOKEN}' },
          },
        },
      },
      null,
      2,
    ),
  );

  constructor() {
    afterNextRender(() => this.origin.set(location.origin));
  }

  protected async onToggle(checked: boolean): Promise<void> {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.toggleError.set('');

    try {
      const response = await firstValueFrom(
        this.http.patch<{ project: DeliveryProject }>(
          `/api/projects/${encodeURIComponent(this.projectSlug())}`,
          { publicDelivery: checked },
        ),
      );
      this.projectUpdated.emit(response.project);
    } catch (error) {
      this.toggleError.set(
        readDeliveryError(error, 'Delivery setting could not be updated.'),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copiedText.set(text);
      setTimeout(() => this.copiedText.set(null), 2000);
    } catch {
      // Clipboard API unavailable or denied — the text stays visible/selectable in place.
    }
  }
}

function readDeliveryError(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.error?.message;

    if (typeof message === 'string') {
      return message;
    }
  }

  return fallback;
}
