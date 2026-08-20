/**
 * Prepared-request model (build-prompt §22–24, §28).
 */
import type { HttpMethod } from './endpoint.js';
import type { SkippedReason } from './result.js';

export interface PreparedRequest {
  method: HttpMethod;
  /** Absolute URL including serialized query string. */
  url: string;
  /** Concrete path after parameter substitution (no query). */
  path: string;
  pathParams: Record<string, unknown>;
  /** Serialized query pairs (name, value) honoring style/explode. */
  query: Array<[string, string]>;
  headers: Record<string, string>;
  contentType?: string;
  /** Structured body (JSON/form/multipart fields) if any. */
  body?: unknown;
  /** Wire representation of the body (JSON string, urlencoded string, ...). */
  bodyString?: string;
}

export interface BuildOk {
  ok: true;
  request: PreparedRequest;
  /** Human-readable notes (which value source filled each slot, etc.). */
  notes: string[];
}

export interface BuildSkip {
  ok: false;
  reason: SkippedReason;
  explanation: string;
}

export type BuildResult = BuildOk | BuildSkip;

export interface ExplicitOverrides {
  body?: unknown;
  query?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  headers?: Record<string, string>;
}
