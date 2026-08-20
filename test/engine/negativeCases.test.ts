import { describe, expect, it } from 'vitest';
import { buildNegativeCases, classifyNegative } from '../../src/engine/execution/negativeCases.js';
import type { Endpoint, HttpMethod } from '../../src/engine/types/endpoint.js';
import type { OpenAPIV3 } from 'openapi-types';

function ep(over: Partial<Endpoint> & { method: HttpMethod; path: string }): Endpoint {
  return { tags: [], deprecated: false, parameters: [], responses: {}, operation: {} as OpenAPIV3.OperationObject, ...over };
}

describe('buildNegativeCases (#7)', () => {
  it('produces a not-found case for a documented 404 with a path param', () => {
    const cases = buildNegativeCases(
      ep({
        method: 'GET',
        path: '/users/{id}',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'ok' }, '404': { description: 'nf' } } as Endpoint['responses'],
      }),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ targetStatus: 404, strategy: 'not-found' });
    expect(cases[0]!.pathParams).toEqual({ id: 2147483647 });
  });

  it('produces a missing-required case for a documented 400 with a required body', () => {
    const cases = buildNegativeCases(
      ep({
        method: 'POST',
        path: '/users',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } },
        } as OpenAPIV3.RequestBodyObject,
        responses: { '201': { description: 'ok' }, '400': { description: 'bad' } } as Endpoint['responses'],
      }),
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ targetStatus: 400, strategy: 'missing-required', body: {} });
  });

  it('produces nothing when the error is not documented or cannot be constructed', () => {
    // 404 documented but no path param -> nothing.
    expect(buildNegativeCases(ep({ method: 'GET', path: '/users', responses: { '404': { description: 'nf' } } as Endpoint['responses'] }))).toEqual([]);
    // path param but no documented 4xx -> nothing.
    expect(
      buildNegativeCases(ep({ method: 'GET', path: '/users/{id}', parameters: [{ name: 'id', in: 'path', schema: { type: 'integer' } }], responses: { '200': { description: 'ok' } } as Endpoint['responses'] })),
    ).toEqual([]);
  });
});

describe('classifyNegative (#7)', () => {
  const base = { targetStatus: 404, actualStatus: 404, schemaChecked: false, schemaValid: true, validationErrors: [] };
  it('PASS when the documented error code is returned', () => {
    expect(classifyNegative({ ...base, documentedResponseKey: '404' }).outcome).toBe('PASS');
  });
  it('FAIL/STATUS_MISMATCH when a success is returned instead of the error', () => {
    expect(classifyNegative({ ...base, actualStatus: 200 })).toMatchObject({ outcome: 'FAIL', reason: 'STATUS_MISMATCH' });
  });
  it('FAIL/SCHEMA_VALIDATION_FAILED when the error body is the wrong shape', () => {
    expect(classifyNegative({ ...base, schemaChecked: true, schemaValid: false })).toMatchObject({
      outcome: 'FAIL',
      reason: 'SCHEMA_VALIDATION_FAILED',
    });
  });
  it('INCONCLUSIVE for a different DOCUMENTED error code', () => {
    expect(classifyNegative({ ...base, actualStatus: 400, documentedResponseKey: '400' })).toMatchObject({
      outcome: 'INCONCLUSIVE',
      reason: 'BUSINESS_RULE_REJECTED',
    });
  });
  it('FAIL/SERVER_ERROR on 5xx', () => {
    expect(classifyNegative({ ...base, actualStatus: 500 })).toMatchObject({ outcome: 'FAIL', reason: 'SERVER_ERROR' });
  });
});
