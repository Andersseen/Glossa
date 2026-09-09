import {
  createError,
  getRequestURL,
  setResponseStatus,
  type H3Event,
} from 'h3';

import { getCmsRuntime } from '../cms/runtime';
import { ProjectValidationError } from '../domain/project';
import {
  isProjectServiceError,
  ProjectDeleteRestrictedError,
  ProjectLocaleConflictError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from '../services/project.service';
import { sendAuthBoundaryError } from './auth-http';
import { getCloudflareEnv } from './env';

export type ProjectErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export async function getRuntimeForEvent(event: H3Event) {
  const cloudflareEnv = getCloudflareEnv(event);
  return getCmsRuntime(cloudflareEnv);
}

export function getProjectSlug(event: H3Event): string {
  const pathname = getRequestURL(event).pathname;
  const slug = pathname.split('/').filter(Boolean).at(-1);

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Project slug is required',
    });
  }

  return decodeURIComponent(slug);
}

export function sendProjectError(
  event: H3Event,
  error: unknown,
): ProjectErrorBody {
  if (isProjectServiceError(error)) {
    const status = getProjectErrorStatus(error);
    setResponseStatus(event, status);

    return {
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return sendAuthBoundaryError(event, error);
}

function getProjectErrorStatus(
  error:
    | ProjectNotFoundError
    | ProjectSlugConflictError
    | ProjectLocaleConflictError
    | ProjectDeleteRestrictedError
    | ProjectValidationError,
): number {
  if (error instanceof ProjectNotFoundError) {
    return 404;
  }

  if (error instanceof ProjectSlugConflictError) {
    return 409;
  }

  if (
    error instanceof ProjectLocaleConflictError ||
    error instanceof ProjectDeleteRestrictedError
  ) {
    return 409;
  }

  return 400;
}
