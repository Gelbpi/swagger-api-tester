import { describe, expect, it } from 'vitest';
import type { OpenAPIV3 } from 'openapi-types';
import { resolveParam } from '../../src/engine/generation/paramResolver.js';
import { FIXED_UUID } from '../../src/engine/generation/dataGenerator.js';

const p = (over: Partial<OpenAPIV3.ParameterObject>): OpenAPIV3.ParameterObject => ({
  name: 'x',
  in: 'query',
  ...over,
});

describe('ParamResolver value-source chain (build-prompt §35, §22, §23)', () => {
  it('SpecExample wins first', () => {
    expect(resolveParam(p({ example: 'E', schema: { type: 'string', default: 'D' } }))).toEqual({
      value: 'E',
      source: 'SpecExample',
    });
  });

  it('falls through default -> enum -> testValues -> format', () => {
    expect(resolveParam(p({ schema: { type: 'string', default: 'D' } }))).toMatchObject({
      source: 'SpecDefault',
    });
    expect(resolveParam(p({ schema: { type: 'string', enum: ['A', 'B'] } }))).toEqual({
      value: 'A',
      source: 'SpecEnum',
    });
    expect(
      resolveParam(p({ name: 'q', schema: { type: 'string' } }), { testValues: { query: { q: 'T' } } }),
    ).toEqual({ value: 'T', source: 'ConfigTestValues' });
    expect(resolveParam(p({ schema: { type: 'integer' } }))).toEqual({
      value: 1,
      source: 'FormatDefault',
    });
  });

  it('path integer -> 1, uuid -> fixed', () => {
    expect(resolveParam(p({ name: 'id', in: 'path', schema: { type: 'integer' } }))?.value).toBe(1);
    expect(
      resolveParam(p({ name: 'id', in: 'path', schema: { type: 'string', format: 'uuid' } }))?.value,
    ).toBe(FIXED_UUID);
  });

  it('never guesses a free-form path string (§22)', () => {
    expect(resolveParam(p({ name: 'key', in: 'path', schema: { type: 'string' } }))).toBeUndefined();
  });

  it('defaults a free-form query string (query is lower risk than path)', () => {
    expect(resolveParam(p({ name: 'q', in: 'query', schema: { type: 'string' } }))).toMatchObject({
      source: 'FormatDefault',
    });
  });
});
