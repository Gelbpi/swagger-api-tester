/**
 * Response validation (build-prompt §32).
 *
 * Validates, in order: HTTP status (documented response lookup), content type,
 * and body schema. Content type ignores charset and honors `* /*` and `+json`.
 * An empty 204-style response with no documented body is valid. Validators are
 * compiled once per (operationId, status, content-type) and cached (§32).
 */
import type { OpenAPIV3 } from 'openapi-types';
import type { Endpoint } from '../types/endpoint.js';
import type { ValidationErrorDetail } from '../types/result.js';
import type { SchemaValidator } from './schemaValidator.js';

export interface ResponseEvaluation {
  /** Documented response key that matched the actual status, or undefined. */
  documentedResponseKey?: string;
  /** The documented response declares body content. */
  contentDocumented: boolean;
  /** Actual content type matched a documented content type (or n/a). */
  contentTypeOk: boolean;
  /** A body schema was actually validated. */
  schemaChecked: boolean;
  schemaValid: boolean;
  validationErrors: ValidationErrorDetail[];
  actualContentType: string;
}

function baseContentType(header: string): string {
  return (header.split(';')[0] ?? '').trim().toLowerCase();
}

function isJsonish(type: string): boolean {
  return type === 'application/json' || type.endsWith('+json') || type.includes('json');
}

/** Does a documented content type accept the actual base content type? */
function contentTypeAccepts(documented: string, actual: string): boolean {
  const d = documented.toLowerCase();
  if (d === '*/*' || d === '') return true;
  if (d === actual) return true;
  if (d.endsWith('/*') && actual.startsWith(d.slice(0, -1))) return true; // application/*
  if (d === 'application/json' && actual.endsWith('+json')) return true; // honor +json
  return false;
}

function findDocumentedResponse(
  responses: Record<string, unknown>,
  status: number,
): { response: OpenAPIV3.ResponseObject; key: string } | undefined {
  const candidates = [String(status), `${Math.floor(status / 100)}XX`, `${Math.floor(status / 100)}xx`, 'default'];
  for (const key of candidates) {
    const r = responses[key];
    if (r) return { response: r as OpenAPIV3.ResponseObject, key };
  }
  return undefined;
}

export function evaluateResponse(
  endpoint: Endpoint,
  actualStatus: number,
  contentTypeHeader: string,
  bodyText: string,
  opts: { validator: SchemaValidator },
): ResponseEvaluation {
  const actualContentType = baseContentType(contentTypeHeader);
  const responses = (endpoint.responses ?? {}) as Record<string, unknown>;
  const found = findDocumentedResponse(responses, actualStatus);

  const base: ResponseEvaluation = {
    contentDocumented: false,
    contentTypeOk: true,
    schemaChecked: false,
    schemaValid: true,
    validationErrors: [],
    actualContentType,
  };

  if (!found) return base;
  base.documentedResponseKey = found.key;

  const content = (found.response.content ?? {}) as Record<string, OpenAPIV3.MediaTypeObject>;
  const documentedTypes = Object.keys(content);
  if (documentedTypes.length === 0) {
    // No body documented (e.g. 204). Any/empty body is acceptable.
    return base;
  }
  base.contentDocumented = true;
  base.contentTypeOk = documentedTypes.some((d) => contentTypeAccepts(d, actualContentType));

  // Pick the media type to validate against: matching one, else the first.
  const mediaKey =
    documentedTypes.find((d) => contentTypeAccepts(d, actualContentType)) ?? documentedTypes[0]!;
  const schema = content[mediaKey]?.schema;
  if (schema && (isJsonish(mediaKey) || isJsonish(actualContentType))) {
    base.schemaChecked = true;
    let parsed: unknown;
    try {
      parsed = bodyText === '' ? undefined : JSON.parse(bodyText);
    } catch {
      base.schemaValid = false;
      base.validationErrors = [{ path: '/', message: 'response body is not valid JSON' }];
      return base;
    }
    const key = `${endpoint.operationId ?? `${endpoint.method} ${endpoint.path}`}#${found.key}#${mediaKey}`;
    const result = opts.validator.validate(schema, parsed, key);
    base.schemaValid = result.valid;
    base.validationErrors = result.errors;
  }
  return base;
}
