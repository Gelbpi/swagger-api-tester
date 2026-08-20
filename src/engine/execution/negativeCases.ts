/**
 * Negative-path test cases (review item #7).
 *
 * Beyond the happy path, deliberately provoke an endpoint's DOCUMENTED error
 * responses and confirm the API returns exactly that status + schema. Two
 * deterministic strategies (only produced when they can actually be constructed):
 *   - not-found     : a documented 404/410 + path params -> use non-existent ids.
 *   - missing-required : a documented 400/422 + a required JSON body -> send {}.
 *
 * Codes we cannot trigger deterministically (409 conflict, 401/403 auth, 5xx) are
 * intentionally NOT attempted — guessing would produce flaky, misleading results.
 */
import type { OpenAPIV3 } from 'openapi-types';
import type { Endpoint } from '../types/endpoint.js';
import type { Outcome, Reason, ValidationErrorDetail } from '../types/result.js';
import { FIXED_UUID } from '../generation/dataGenerator.js';

export interface NegativeCase {
  targetStatus: number;
  strategy: 'not-found' | 'missing-required';
  description: string;
  pathParams?: Record<string, unknown>;
  body?: unknown;
}

const NOT_FOUND_STATUSES = [404, 410];
const BAD_REQUEST_STATUSES = [400, 422];

function responseDocuments(responses: Record<string, unknown>, status: number): boolean {
  const range = `${Math.floor(status / 100)}`;
  return (
    responses[String(status)] !== undefined ||
    responses[`${range}XX`] !== undefined ||
    responses[`${range}xx`] !== undefined
  );
}

function notFoundValue(param: OpenAPIV3.ParameterObject): unknown {
  const schema = (param.schema as Record<string, unknown> | undefined) ?? {};
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'integer' || type === 'number') return 2147483647;
  if (type === 'boolean') return false;
  if (schema.format === 'uuid') return FIXED_UUID; // a valid uuid that (almost) never exists
  return 'does-not-exist';
}

function requiredJsonBody(endpoint: Endpoint): boolean {
  const media = endpoint.requestBody?.content?.['application/json'] as
    | OpenAPIV3.MediaTypeObject
    | undefined;
  const schema = media?.schema as { required?: unknown } | undefined;
  return !!schema && Array.isArray(schema.required) && schema.required.length > 0;
}

/** Build the deterministic negative cases for an endpoint (may be empty). */
export function buildNegativeCases(endpoint: Endpoint): NegativeCase[] {
  const responses = (endpoint.responses ?? {}) as Record<string, unknown>;
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const cases: NegativeCase[] = [];

  if (pathParams.length > 0) {
    for (const status of NOT_FOUND_STATUSES) {
      if (!responseDocuments(responses, status)) continue;
      const values: Record<string, unknown> = {};
      for (const p of pathParams) values[p.name] = notFoundValue(p);
      cases.push({
        targetStatus: status,
        strategy: 'not-found',
        description: `expect ${status} for a non-existent resource`,
        pathParams: values,
      });
      break; // one not-found case is enough (404 or 410)
    }
  }

  if (requiredJsonBody(endpoint)) {
    for (const status of BAD_REQUEST_STATUSES) {
      if (!responseDocuments(responses, status)) continue;
      cases.push({
        targetStatus: status,
        strategy: 'missing-required',
        description: `expect ${status} for a body missing required fields`,
        body: {},
      });
      break;
    }
  }

  return cases;
}

export interface NegativeClassifyInput {
  targetStatus: number;
  actualStatus: number;
  documentedResponseKey?: string;
  schemaChecked: boolean;
  schemaValid: boolean;
  validationErrors: ValidationErrorDetail[];
}

export interface NegativeClassification {
  outcome: Outcome;
  reason: Reason | null;
  explanation: string;
  validationErrors: ValidationErrorDetail[];
}

/** Classify a negative case: getting the documented error IS success. */
export function classifyNegative(input: NegativeClassifyInput): NegativeClassification {
  const { targetStatus, actualStatus, documentedResponseKey, schemaChecked, schemaValid } = input;
  const none: ValidationErrorDetail[] = [];

  if (actualStatus >= 500) {
    return { outcome: 'FAIL', reason: 'SERVER_ERROR', explanation: `[negative] server returned ${actualStatus}`, validationErrors: none };
  }
  if (actualStatus === targetStatus) {
    if (schemaChecked && !schemaValid) {
      return {
        outcome: 'FAIL',
        reason: 'SCHEMA_VALIDATION_FAILED',
        explanation: `[negative] got expected ${actualStatus} but the error body failed its schema`,
        validationErrors: input.validationErrors,
      };
    }
    return { outcome: 'PASS', reason: null, explanation: `[negative] correctly returned documented ${actualStatus}`, validationErrors: none };
  }
  if (actualStatus >= 200 && actualStatus < 400) {
    return {
      outcome: 'FAIL',
      reason: 'STATUS_MISMATCH',
      explanation: `[negative] expected ${targetStatus}, got success ${actualStatus} — the error path is not enforced`,
      validationErrors: none,
    };
  }
  // A different 4xx: acceptable if documented, otherwise a contract gap.
  if (documentedResponseKey !== undefined) {
    return {
      outcome: 'INCONCLUSIVE',
      reason: 'BUSINESS_RULE_REJECTED',
      explanation: `[negative] expected ${targetStatus}, got a different documented error ${actualStatus}`,
      validationErrors: none,
    };
  }
  return {
    outcome: 'FAIL',
    reason: 'UNDOCUMENTED_ERROR_SHAPE',
    explanation: `[negative] expected ${targetStatus}, got undocumented ${actualStatus}`,
    validationErrors: none,
  };
}
