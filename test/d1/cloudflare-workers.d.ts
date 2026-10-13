/** The only binding the test Worker declares — see `vitest.d1.config.ts`. */
declare module 'cloudflare:workers' {
  export const env: { DB: import('@forge-cms/cloudflare').D1Database };
}
