/**
 * Shared result model and reason enums (build-prompt §10 and §11).
 *
 * Every test resolves to exactly one Outcome. Each non-PASS result carries a
 * machine-readable `reason` plus one short human-readable `explanation`. Reasons
 * are partitioned: a given reason belongs to exactly one category (enforced by a
 * test in test/engine/reasons.test.ts).
 */

export const OUTCOMES = ['PASS', 'FAIL', 'INCONCLUSIVE', 'SKIPPED', 'ENGINE_ERROR'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SKIPPED_REASONS = [
  'NO_TEST_DATA',
  'MISSING_DEPENDENCY',
  'AUTH_UNAVAILABLE',
  'AUTH_PROFILE_MISSING',
  'MUTATIONS_DISABLED',
  'DESTRUCTIVE_OPERATION',
  'SIDE_EFFECT_RISK',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNGENERATABLE_SCHEMA',
  'PATTERN_UNSATISFIABLE',
  'CIRCULAR_SCHEMA_DEPTH',
  'EXCLUDED_BY_CONFIG',
  'DEPRECATED_OPERATION',
  'RATE_LIMITED',
] as const;
export type SkippedReason = (typeof SKIPPED_REASONS)[number];

export const FAIL_REASONS = [
  'SERVER_ERROR',
  'STATUS_MISMATCH',
  'UNDOCUMENTED_ERROR_SHAPE',
  'CONTENT_TYPE_MISMATCH',
  'SCHEMA_VALIDATION_FAILED',
  'MISSING_REQUIRED_FIELD',
  'TIMEOUT_EXCEEDED',
] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

export const INCONCLUSIVE_REASONS = [
  'BUSINESS_RULE_REJECTED',
  'AUTH_INSUFFICIENT_SCOPE',
  'PRECONDITION_UNKNOWN',
] as const;
export type InconclusiveReason = (typeof INCONCLUSIVE_REASONS)[number];

export const ENGINE_ERROR_REASONS = [
  'CONNECTION_REFUSED',
  'DNS_FAILURE',
  'TLS_ERROR',
  'SPEC_UNREACHABLE',
  'SPEC_INVALID',
  'SPEC_UNSUPPORTED_VERSION',
  'CONFIG_INVALID',
  'CONFIG_NOT_FOUND',
  'PROJECT_AMBIGUOUS',
  'SEED_FAILED',
  'GENERATOR_ERROR',
  'CANCELLED',
  'TARGET_REFUSED_BY_POLICY',
] as const;
export type EngineErrorReason = (typeof ENGINE_ERROR_REASONS)[number];

export type Reason = SkippedReason | FailReason | InconclusiveReason | EngineErrorReason;

/** Category lookup: reason -> the single Outcome bucket it belongs to. */
export const REASON_CATEGORY: Readonly<Record<Reason, Outcome>> = Object.freeze({
  ...Object.fromEntries(SKIPPED_REASONS.map((r) => [r, 'SKIPPED'] as const)),
  ...Object.fromEntries(FAIL_REASONS.map((r) => [r, 'FAIL'] as const)),
  ...Object.fromEntries(INCONCLUSIVE_REASONS.map((r) => [r, 'INCONCLUSIVE'] as const)),
  ...Object.fromEntries(ENGINE_ERROR_REASONS.map((r) => [r, 'ENGINE_ERROR'] as const)),
}) as Record<Reason, Outcome>;

export interface ValidationErrorDetail {
  /** JSON Pointer into the response body, e.g. "/items/0/total". */
  path: string;
  message: string;
}

/** The compact result surfaced through the MCP tools (build-prompt §8). */
export interface CompactTestResult {
  testId: string;
  runId: string;
  outcome: Outcome;
  reason: Reason | null;
  explanation: string | null;
  method: string;
  path: string;
  expectedStatus: number | null;
  actualStatus: number | null;
  durationMs: number | null;
  validationErrors: ValidationErrorDetail[];
  /** Present only for non-PASS results; never a full success body. */
  bodyExcerpt: string | null;
  detailsUri: string;
}
