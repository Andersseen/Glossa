import type { H3Event } from 'h3';

/**
 * Runs `task` after the response without delaying it. On Cloudflare the task is handed to the
 * request's `waitUntil`, which keeps the isolate alive until it settles; elsewhere (`pnpm dev`,
 * Node preview, Vitest) there is no such hook and the long-lived process simply lets it finish.
 * Either way a rejection is swallowed here — background work is best-effort by definition and must
 * never become an unhandled rejection. Callers own any error recording they need.
 */
export function runInBackground(event: H3Event, task: Promise<unknown>): void {
  const settled = task.catch(() => undefined);
  const waitUntil = (
    event.context as { waitUntil?: (promise: Promise<unknown>) => void }
  ).waitUntil;

  if (typeof waitUntil === 'function') {
    waitUntil(settled);
  } else {
    void settled;
  }
}
