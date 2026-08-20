/**
 * Response classification (build-prompt §33).
 *
 *   5xx                              -> FAIL / SERVER_ERROR
 *   401/403, no/expired credentials  -> SKIPPED / AUTH_UNAVAILABLE
 *   401/403, credentials applied     -> INCONCLUSIVE / AUTH_INSUFFICIENT_SCOPE
 *   4xx matching documented schema   -> INCONCLUSIVE / BUSINESS_RULE_REJECTED
 *   4xx matching nothing documented  -> FAIL / UNDOCUMENTED_ERROR_SHAPE
 *   correct status, invalid body     -> FAIL / SCHEMA_VALIDATION_FAILED
 *   correct status, wrong content ty -> FAIL / CONTENT_TYPE_MISMATCH
 *   success but unexpected/undocumented status -> FAIL / STATUS_MISMATCH
 *   otherwise                        -> PASS
 *
 * Engine/transport problems are classified elsewhere — never here.
 */
import type { Outcome, Reason, ValidationErrorDetail } from '../types/result.js';

export interface ClassifyInput {
  expectedStatus: number;
  actualStatus: number;
  /** Spec documents only a `default` response, so any 2xx is acceptable (§31). */
  onlyDefault: boolean;
  /** Documented response key that matched the actual status, or undefined. */
  documentedResponseKey?: string;
  contentDocumented: boolean;
  contentTypeOk: boolean;
  schemaChecked: boolean;
  schemaValid: boolean;
  /** Whether resolved credentials were applied to the request. */
  hasCredentials: boolean;
  validationErrors: ValidationErrorDetail[];
}

export interface Classification {
  outcome: Outcome;
  reason: Reason | null;
  explanation: string;
  validationErrors: ValidationErrorDetail[];
}

const isSuccess = (s: number): boolean => s >= 200 && s < 400;

export function classifyResponse(input: ClassifyInput): Classification {
  const {
    expectedStatus,
    actualStatus,
    documentedResponseKey,
    contentDocumented,
    contentTypeOk,
    schemaChecked,
    schemaValid,
    hasCredentials,
    validationErrors,
  } = input;

  const none: ValidationErrorDetail[] = [];

  // 5xx
  if (actualStatus >= 500) {
    return {
      outcome: 'FAIL',
      reason: 'SERVER_ERROR',
      explanation: `server returned ${actualStatus}`,
      validationErrors: none,
    };
  }

  // 401 / 403
  if (actualStatus === 401 || actualStatus === 403) {
    if (!hasCredentials) {
      return {
        outcome: 'SKIPPED',
        reason: 'AUTH_UNAVAILABLE',
        explanation: `${actualStatus} with no credentials applied`,
        validationErrors: none,
      };
    }
    return {
      outcome: 'INCONCLUSIVE',
      reason: 'AUTH_INSUFFICIENT_SCOPE',
      explanation: `${actualStatus} despite applied credentials`,
      validationErrors: none,
    };
  }

  // Other 4xx
  if (actualStatus >= 400) {
    const documentedAndValid = documentedResponseKey !== undefined && (!schemaChecked || schemaValid);
    if (documentedAndValid) {
      return {
        outcome: 'INCONCLUSIVE',
        reason: 'BUSINESS_RULE_REJECTED',
        explanation: `${actualStatus} matches documented error response`,
        validationErrors: none,
      };
    }
    return {
      outcome: 'FAIL',
      reason: 'UNDOCUMENTED_ERROR_SHAPE',
      explanation:
        documentedResponseKey === undefined
          ? `${actualStatus} is not documented`
          : `${actualStatus} body does not match its documented schema`,
      validationErrors,
    };
  }

  // Success range (2xx / 3xx)
  const statusOk =
    actualStatus === expectedStatus ||
    (isSuccess(actualStatus) && (documentedResponseKey !== undefined || input.onlyDefault));

  if (!statusOk) {
    return {
      outcome: 'FAIL',
      reason: 'STATUS_MISMATCH',
      explanation: `expected ${expectedStatus}, got ${actualStatus}`,
      validationErrors: none,
    };
  }

  if (contentDocumented && !contentTypeOk) {
    return {
      outcome: 'FAIL',
      reason: 'CONTENT_TYPE_MISMATCH',
      explanation: `response content type not documented for ${actualStatus}`,
      validationErrors: none,
    };
  }

  if (schemaChecked && !schemaValid) {
    return {
      outcome: 'FAIL',
      reason: 'SCHEMA_VALIDATION_FAILED',
      explanation: `${actualStatus} body failed the documented schema`,
      validationErrors,
    };
  }

  return { outcome: 'PASS', reason: null, explanation: 'response matched the contract', validationErrors: none };
}
