import { describe, expect, it } from 'vitest';
import { RefResolver, isRef, resolveRef } from '../../src/engine/openapi/refResolver.js';
import { EngineError } from '../../src/engine/types/errors.js';

const reasonOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as EngineError).reason;
  }
  throw new Error('expected throw');
};

const doc = {
  components: {
    schemas: {
      User: { type: 'object', properties: { manager: { $ref: '#/components/schemas/User' } } },
      Alias: { $ref: '#/components/schemas/User' },
      'weird/name': { type: 'string' },
    },
  },
};

describe('RefResolver (build-prompt §19)', () => {
  it('resolves local pointers, including escaped tokens', () => {
    expect((resolveRef(doc, '#/components/schemas/User') as Record<string, unknown>).type).toBe(
      'object',
    );
    expect((resolveRef(doc, '#/components/schemas/weird~1name') as Record<string, unknown>).type).toBe(
      'string',
    );
    expect(resolveRef(doc, '#')).toBe(doc);
  });

  it('throws SPEC_INVALID on unresolvable / non-local refs', () => {
    expect(reasonOf(() => resolveRef(doc, '#/nope'))).toBe('SPEC_INVALID');
    expect(() => resolveRef(doc, 'http://x/y')).toThrowError(EngineError);
  });

  it('isRef detects $ref nodes', () => {
    expect(isRef({ $ref: '#/x' })).toBe(true);
    expect(isRef({ type: 'string' })).toBe(false);
  });

  it('deref follows a single alias', () => {
    const r = new RefResolver(doc);
    expect(r.deref<Record<string, unknown>>({ $ref: '#/components/schemas/Alias' }).type).toBe(
      'object',
    );
  });

  it('deref throws on a pure circular $ref chain', () => {
    const circular = {
      components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } } },
    };
    const r = new RefResolver(circular);
    expect(reasonOf(() => r.deref({ $ref: '#/components/schemas/A' }))).toBe('SPEC_INVALID');
  });
});
