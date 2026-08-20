import { describe, expect, it } from 'vitest';
import { evaluateResponse } from '../../src/engine/validation/responseValidator.js';
import { SchemaValidator } from '../../src/engine/validation/schemaValidator.js';
import type { Endpoint, HttpMethod } from '../../src/engine/types/endpoint.js';

const validator = new SchemaValidator();

function ep(method: HttpMethod, responses: Record<string, unknown>): Endpoint {
  return {
    method,
    path: '/x',
    operationId: 'op',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: responses as Endpoint['responses'],
    operation: {} as never,
  };
}

const userResponses = {
  '200': {
    description: 'ok',
    content: {
      'application/json': {
        schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      },
    },
  },
  '404': { description: 'not found', content: { 'application/json': { schema: { type: 'object' } } } },
};

describe('evaluateResponse (build-prompt §32)', () => {
  it('valid body passes schema + content type', () => {
    const e = evaluateResponse(ep('GET', userResponses), 200, 'application/json; charset=utf-8', '{"id":1}', {
      validator,
    });
    expect(e.documentedResponseKey).toBe('200');
    expect(e.contentTypeOk).toBe(true);
    expect(e.schemaChecked).toBe(true);
    expect(e.schemaValid).toBe(true);
  });

  it('invalid body reports schema errors', () => {
    const e = evaluateResponse(ep('GET', userResponses), 200, 'application/json', '{"id":"nope"}', {
      validator,
    });
    expect(e.schemaValid).toBe(false);
    expect(e.validationErrors.length).toBeGreaterThan(0);
  });

  it('honors +json as application/json', () => {
    const e = evaluateResponse(ep('GET', userResponses), 200, 'application/vnd.api+json', '{"id":1}', {
      validator,
    });
    expect(e.contentTypeOk).toBe(true);
    expect(e.schemaValid).toBe(true);
  });

  it('content type mismatch is detected', () => {
    const e = evaluateResponse(ep('GET', userResponses), 200, 'text/html', '<html>', { validator });
    expect(e.contentTypeOk).toBe(false);
  });

  it('empty 204 with no documented body is valid', () => {
    const e = evaluateResponse(ep('DELETE', { '204': { description: 'gone' } }), 204, '', '', {
      validator,
    });
    expect(e.documentedResponseKey).toBe('204');
    expect(e.contentDocumented).toBe(false);
    expect(e.contentTypeOk).toBe(true);
    expect(e.schemaChecked).toBe(false);
  });

  it('undocumented status yields no documented key', () => {
    const e = evaluateResponse(ep('GET', userResponses), 418, 'application/json', '{}', { validator });
    expect(e.documentedResponseKey).toBeUndefined();
  });

  it('malformed JSON body fails schema', () => {
    const e = evaluateResponse(ep('GET', userResponses), 200, 'application/json', 'not json', {
      validator,
    });
    expect(e.schemaValid).toBe(false);
  });
});
