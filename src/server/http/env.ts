import type { H3Event } from 'h3';

import type { GlossaCmsEnv } from '../cms/runtime';

export function getCloudflareEnv(event: H3Event): GlossaCmsEnv {
  const context = event.context as {
    cloudflare?: {
      env?: GlossaCmsEnv;
    };
  };

  return {
    AUTH_SECRET: process.env['AUTH_SECRET'],
    BOOTSTRAP_ADMIN_KEY: process.env['BOOTSTRAP_ADMIN_KEY'],
    ...context.cloudflare?.env,
  };
}
