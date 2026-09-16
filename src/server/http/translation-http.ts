import { setResponseStatus, type H3Event } from 'h3';

import {
  TranslationKeyExistsError,
  isTranslationServiceError,
  type TranslationWriteResponse,
} from '../services/translation-workspace.service';
import { sendCatalogError, type CatalogErrorBody } from './catalog-http';

export type TranslationErrorBody = CatalogErrorBody;

/**
 * Request-level failures only (unknown key shape, duplicate key, project not found, unauthorized).
 * A per-locale problem inside a multi-locale save — a stale revision above all — is never thrown:
 * it is reported in the response's `results` array (see `setTranslationWriteStatus`) so the UI can
 * say exactly which locales were saved and which were not, instead of a single opaque failure.
 */
export function sendTranslationError(
  event: H3Event,
  error: unknown,
): TranslationErrorBody {
  if (isTranslationServiceError(error)) {
    setResponseStatus(
      event,
      error instanceof TranslationKeyExistsError ? 409 : 400,
    );

    return { error: { code: error.code, message: error.message } };
  }

  return sendCatalogError(event, error);
}

/**
 * `409` whenever any locale in the write failed, so a client that only checks the HTTP status
 * never reports "Saved" for a catalog that was not written; the body still carries the per-locale
 * detail either way. `InvalidTranslationKeyError` is handled above rather than here — it is a bad
 * request, not a conflict.
 */
export function setTranslationWriteStatus(
  event: H3Event,
  response: TranslationWriteResponse,
  createdStatus = 200,
): TranslationWriteResponse {
  setResponseStatus(event, response.saved ? createdStatus : 409);
  return response;
}
