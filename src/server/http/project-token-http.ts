import {
  createError,
  getRequestURL,
  setResponseStatus,
  type H3Event,
} from 'h3';

import { ProjectTokenValidationError } from '../domain/project-token';
import {
  isProjectTokenServiceError,
  ProjectTokenNotFoundError,
} from '../services/project-token.service';
import { sendProjectError, type ProjectErrorBody } from './project-http';

export type ProjectTokenErrorBody = ProjectErrorBody;

export function getTokenId(event: H3Event): string {
  const segments = getRequestURL(event).pathname.split('/').filter(Boolean);
  const index = segments.indexOf('tokens');
  const value = index >= 0 ? segments[index + 1] : undefined;

  if (!value) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Token id is required',
    });
  }

  return decodeURIComponent(value);
}

export function sendProjectTokenError(
  event: H3Event,
  error: unknown,
): ProjectTokenErrorBody {
  if (error instanceof ProjectTokenValidationError) {
    setResponseStatus(event, 400);

    return { error: { code: error.code, message: error.message } };
  }

  if (isProjectTokenServiceError(error)) {
    setResponseStatus(
      event,
      error instanceof ProjectTokenNotFoundError ? 404 : 400,
    );

    return { error: { code: error.code, message: error.message } };
  }

  return sendProjectError(event, error);
}
