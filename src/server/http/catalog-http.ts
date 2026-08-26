import {
  createError,
  getRequestURL,
  setResponseStatus,
  type H3Event,
} from 'h3';

import type { CatalogValidationError } from '../domain/catalog';
import {
  isCatalogServiceError,
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
} from '../services/catalog.service';
import { sendProjectError, type ProjectErrorBody } from './project-http';

export type CatalogErrorBody = ProjectErrorBody;

export function getProjectSlug(event: H3Event): string {
  return getPathSegmentAfter(event, 'projects', 'Project slug is required');
}

export function getCatalogLocale(event: H3Event): string {
  return getPathSegmentAfter(event, 'catalogs', 'Catalog locale is required');
}

export function sendCatalogError(
  event: H3Event,
  error: unknown,
): CatalogErrorBody {
  if (isCatalogServiceError(error)) {
    setCatalogErrorStatus(event, error);

    return {
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return sendProjectError(event, error);
}

function setCatalogErrorStatus(
  event: H3Event,
  error:
    | CatalogNotFoundError
    | CatalogLocaleNotConfiguredError
    | CatalogValidationError,
): void {
  setResponseStatus(event, error instanceof CatalogNotFoundError ? 404 : 400);
}

function getPathSegmentAfter(
  event: H3Event,
  marker: string,
  missingMessage: string,
): string {
  const segments = getRequestURL(event).pathname.split('/').filter(Boolean);
  const index = segments.indexOf(marker);
  const value = index >= 0 ? segments[index + 1] : undefined;

  if (!value) {
    throw createError({ statusCode: 400, statusMessage: missingMessage });
  }

  return decodeURIComponent(value);
}
