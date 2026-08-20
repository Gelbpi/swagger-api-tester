import { describe, expect, it } from 'vitest';
import { EndpointRegistry } from '../../src/engine/openapi/endpointRegistry.js';
import { buildPlan } from '../../src/engine/execution/planBuilder.js';
import { sampleDoc } from '../util/sampleDoc.js';

const reg = new EndpointRegistry(sampleDoc);
const keys = (eps: ReturnType<typeof buildPlan>) => eps.map((e) => `${e.method} ${e.path}`);

describe('PlanBuilder (build-prompt §34)', () => {
  it('orders deterministically by path then method', () => {
    expect(keys(buildPlan(reg))).toEqual([
      'GET /users',
      'POST /users',
      'DELETE /users/{id}',
      'GET /users/{id}',
      'GET /users/{id}/orders',
    ]);
  });

  it('filters by method', () => {
    expect(keys(buildPlan(reg, { methods: ['post'] }))).toEqual(['POST /users']);
  });

  it('filters by tag', () => {
    expect(keys(buildPlan(reg, { tags: ['users'] }))).toEqual(['GET /users']);
  });

  it('applies include and exclude globs', () => {
    expect(keys(buildPlan(reg, { include: ['* /users'] }))).toEqual(['GET /users', 'POST /users']);
    expect(keys(buildPlan(reg, { exclude: ['DELETE *'] }))).not.toContain('DELETE /users/{id}');
  });

  it('producers-first: fewer path params first, reads before writes (§34)', () => {
    const ordered = keys(buildPlan(reg, { order: 'producers-first' }));
    // 0-param endpoints (/users) come before 1-param (/users/{id}) before 2-param.
    expect(ordered).toEqual([
      'GET /users',
      'POST /users',
      'GET /users/{id}',
      'DELETE /users/{id}',
      'GET /users/{id}/orders',
    ]);
    // A collection GET always precedes its own item GET.
    expect(ordered.indexOf('GET /users')).toBeLessThan(ordered.indexOf('GET /users/{id}'));
  });
});
