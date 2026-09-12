import { setResponseStatus, type H3Event } from 'h3';

import {
  isCatalogImportBatchError,
  type CatalogImportValidationError,
} from '../services/catalog-import.service';
import { sendCatalogError, type CatalogErrorBody } from './catalog-http';

export type CatalogImportErrorBody = CatalogErrorBody;

/**
 * Only for request-level failures (malformed batch shape, project not found, unauthorized,
 * forbidden) — per-item problems (unknown locale, duplicate mapping, invalid JSON shape, existing
 * catalog needing explicit replacement, a stale revision) are never thrown; they are reported in
 * the response's `results` array so the UI can show them next to the file that caused them.
 */
export function sendCatalogImportError(
  event: H3Event,
  error: unknown,
): CatalogImportErrorBody {
  if (isCatalogImportBatchError(error)) {
    setResponseStatus(event, 400);

    return errorBody(error);
  }

  return sendCatalogError(event, error);
}

function errorBody(
  error: CatalogImportValidationError,
): CatalogImportErrorBody {
  return { error: { code: error.code, message: error.message } };
}
