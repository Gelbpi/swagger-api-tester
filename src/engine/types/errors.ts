import type { EngineErrorReason } from './result.js';
import { maskString } from '../results/sanitizer.js';

/**
 * A categorized, sanitized engine failure. The message is masked at throw time
 * so a leaked secret can never travel inside an error (build-prompt §14).
 */
export class EngineError extends Error {
  readonly reason: EngineErrorReason;
  /** Optional actionable hint surfaced to the user. */
  readonly hint?: string;

  constructor(reason: EngineErrorReason, message: string, hint?: string) {
    super(maskString(message));
    this.name = 'EngineError';
    this.reason = reason;
    if (hint !== undefined) this.hint = maskString(hint);
  }
}
