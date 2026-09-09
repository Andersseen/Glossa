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
    DEV_AUTH_ISSUER: process.env['DEV_AUTH_ISSUER'],
    DEV_AUTH_CLIENT_ID: process.env['DEV_AUTH_CLIENT_ID'],
    DEV_AUTH_CLIENT_SECRET: process.env['DEV_AUTH_CLIENT_SECRET'],
    DEV_AUTH_REDIRECT_URI: process.env['DEV_AUTH_REDIRECT_URI'],
    ...context.cloudflare?.env,
  };
}
