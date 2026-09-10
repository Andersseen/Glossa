import {
  CatalogLocaleNotConfiguredError,
  CatalogNotFoundError,
  CatalogRevisionConflictError,
} from '../services/catalog.service';
import { CatalogValidationError } from '../domain/catalog';
import { InvalidTranslationKeyError } from '../domain/translation-path';

export class McpScopeError extends Error {
  readonly code = 'INVALID_SCOPE';

  constructor(message: string) {
    super(message);
  }
}

export class TranslationNotFoundError extends Error {
  readonly code = 'TRANSLATION_NOT_FOUND';

  constructor() {
    super('Translation not found.');
  }
}

type McpToolResult = {
  content: { type: 'text'; text: string }[];
  isError: true;
};

/**
 * Maps the shared catalog/translation domain errors (the same ones the human UI and Machine API
 * already surface) into the brief's small, stable MCP error-code set — one place, reused by every
 * tool, so a code is never invented per call site and nothing raw (SQL, Forge internals, stack
 * traces) ever reaches the client. Anything not recognized here is rethrown — the SDK turns an
 * uncaught tool-handler error into its own generic tool error result.
 */
export function toToolError(error: unknown): McpToolResult {
  if (error instanceof McpScopeError) {
    return errorResult(error.code, error.message);
  }

  if (error instanceof CatalogLocaleNotConfiguredError) {
    return errorResult('LOCALE_NOT_CONFIGURED', error.message);
  }

  if (error instanceof CatalogNotFoundError) {
    return errorResult('CATALOG_NOT_FOUND', error.message);
  }

  if (error instanceof TranslationNotFoundError) {
    return errorResult('TRANSLATION_NOT_FOUND', error.message);
  }

  if (error instanceof CatalogRevisionConflictError) {
    return errorResult('CATALOG_REVISION_CONFLICT', error.message, {
      currentRevision: error.currentRevision,
    });
  }

  if (error instanceof InvalidTranslationKeyError) {
    return errorResult('INVALID_TRANSLATION_KEY', error.message);
  }

  if (error instanceof CatalogValidationError) {
    return errorResult('INVALID_TRANSLATION_VALUE', error.message);
  }

  throw error;
}

function errorResult(
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): McpToolResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify({ code, message, ...extra }) },
    ],
    isError: true,
  };
}
