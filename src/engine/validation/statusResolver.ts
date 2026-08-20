/**
 * Expected-status resolution (build-prompt §31).
 *
 * Priority:
 *   1. explicit expectStatus (test_endpoint);
 *   2. config.expectations["METHOD /path"];
 *   3. lowest documented 2xx;
 *   4. method convention;
 *   5. documented default response, if only `default` exists.
 * The chosen rule is reported so the result can explain its expectation.
 */
import type { Endpoint, HttpMethod } from '../types/endpoint.js';

export interface ExpectedStatus {
  status: number;
  logic: string;
  /** True when the spec documents only a `default` response (any 2xx accepted). */
  onlyDefault: boolean;
}

const METHOD_CONVENTION: Record<HttpMethod, number> = {
  POST: 201,
  PUT: 200,
  PATCH: 200,
  DELETE: 204,
  GET: 200,
  HEAD: 200,
  OPTIONS: 200,
  TRACE: 200,
};

function documented2xx(responses: Record<string, unknown>): number[] {
  const codes: number[] = [];
  for (const key of Object.keys(responses)) {
    if (/^2\d\d$/.test(key)) codes.push(Number(key));
    else if (/^2xx$/i.test(key)) codes.push(200);
  }
  return codes.sort((a, b) => a - b);
}

export function resolveExpectedStatus(
  endpoint: Endpoint,
  opts: { expectStatus?: number; expectations?: Record<string, number> } = {},
): ExpectedStatus {
  if (typeof opts.expectStatus === 'number') {
    return { status: opts.expectStatus, logic: 'explicit expectStatus', onlyDefault: false };
  }
  const key = `${endpoint.method} ${endpoint.path}`;
  const configured = opts.expectations?.[key];
  if (typeof configured === 'number') {
    return { status: configured, logic: `config.expectations["${key}"]`, onlyDefault: false };
  }

  const responses = (endpoint.responses ?? {}) as Record<string, unknown>;
  const twoxx = documented2xx(responses);
  if (twoxx.length > 0) {
    return { status: twoxx[0]!, logic: `lowest documented 2xx (${twoxx[0]})`, onlyDefault: false };
  }

  const keys = Object.keys(responses);
  const onlyDefault = keys.length > 0 && keys.every((k) => k.toLowerCase() === 'default');
  const convention = METHOD_CONVENTION[endpoint.method];
  return {
    status: convention,
    logic: onlyDefault
      ? `method convention (${endpoint.method} -> ${convention}); spec documents only "default"`
      : `method convention (${endpoint.method} -> ${convention})`,
    onlyDefault,
  };
}
