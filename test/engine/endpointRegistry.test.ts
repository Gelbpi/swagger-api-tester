import { describe, expect, it } from 'vitest';
import { EndpointRegistry } from '../../src/engine/openapi/endpointRegistry.js';
import { sampleDoc } from '../util/sampleDoc.js';

describe('EndpointRegistry (build-prompt §3/§19)', () => {
  const reg = new EndpointRegistry(sampleDoc);

  it('flattens all operations deterministically', () => {
    const keys = reg.list().map((e) => `${e.method} ${e.path}`);
    expect(keys).toEqual([
      'GET /users',
      'POST /users',
      'GET /users/{id}',
      'DELETE /users/{id}',
      'GET /users/{id}/orders',
    ]);
  });

  it('exact lookup and operation metadata', () => {
    const del = reg.get('DELETE', '/users/{id}')!;
    expect(del.operationId).toBe('deleteUser');
    expect(del.deprecated).toBe(true);
    const list = reg.get('GET', '/users')!;
    expect(list.tags).toEqual(['users']);
  });

  it('resolves $ref parameters and merges path-level + operation-level', () => {
    const getUser = reg.get('GET', '/users/{id}')!;
    expect(getUser.parameters.map((p) => `${p.in}:${p.name}`)).toEqual(['path:id']);

    const orders = reg.get('GET', '/users/{id}/orders')!;
    expect(orders.parameters.map((p) => `${p.in}:${p.name}`).sort()).toEqual([
      'path:id',
      'query:page',
    ]);
  });

  it('exposes requestBody when present', () => {
    expect(reg.get('POST', '/users')!.requestBody).toBeDefined();
    expect(reg.get('GET', '/users')!.requestBody).toBeUndefined();
  });

  it('lists distinct paths', () => {
    expect(reg.paths()).toEqual(['/users', '/users/{id}', '/users/{id}/orders']);
  });
});
