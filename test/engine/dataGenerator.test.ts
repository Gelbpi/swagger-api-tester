import { describe, expect, it } from 'vitest';
import { FIXED_UUID, generateValue } from '../../src/engine/generation/dataGenerator.js';

const gen = (schema: unknown, seed = 'op#p') => generateValue(schema, { seed });

describe('DataGenerator (build-prompt §20)', () => {
  it('is deterministic for the same schema + seed', () => {
    const schema = {
      type: 'object',
      required: ['name', 'code', 'tags'],
      properties: {
        name: { type: 'string' },
        code: { type: 'string', pattern: '^[a-z]{4}[0-9]{2}$' },
        tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
      },
    };
    expect(gen(schema)).toEqual(gen(schema));
  });

  it('honors source priority: example > default > enum > const', () => {
    expect(gen({ type: 'string', example: 'EX', default: 'DEF', enum: ['EN'] })).toBe('EX');
    expect(gen({ type: 'string', default: 'DEF', enum: ['EN'] })).toBe('DEF');
    expect(gen({ type: 'string', enum: ['EN', 'other'] })).toBe('EN');
    expect(gen({ const: 42 })).toBe(42);
  });

  it('produces format-aware values', () => {
    expect(gen({ type: 'string', format: 'uuid' })).toBe(FIXED_UUID);
    expect(gen({ type: 'string', format: 'email' })).toBe('test@example.com');
    expect(gen({ type: 'string', format: 'date-time' })).toBe('2020-01-01T00:00:00Z');
  });

  it('respects numeric constraints', () => {
    expect(gen({ type: 'integer', minimum: 3, multipleOf: 5 })).toBe(5);
    expect(gen({ type: 'integer', exclusiveMinimum: 5 })).toBe(6);
    expect(gen({ type: 'number', minimum: 2, maximum: 2 })).toBe(2);
  });

  it('respects string length and pattern', () => {
    const s = gen({ type: 'string', minLength: 8 }) as string;
    expect(s.length).toBeGreaterThanOrEqual(8);
    const code = gen({ type: 'string', pattern: '^[a-z]{4}[0-9]{2}$' }) as string;
    expect(code).toMatch(/^[a-z]{4}[0-9]{2}$/);
  });

  it('respects array minItems', () => {
    const arr = gen({ type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 3 }) as number[];
    expect(arr).toHaveLength(3);
    expect(arr.every((n) => n >= 1)).toBe(true);
  });

  it('emits required props and optional props with an explicit source only', () => {
    const out = gen({
      type: 'object',
      required: ['a'],
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        c: { type: 'string', default: 'x' },
      },
    }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['a', 'c']);
    expect(out.c).toBe('x');
  });

  it('applies config.testValues by name and by format', () => {
    const out = generateValue(
      {
        type: 'object',
        required: ['id', 'token'],
        properties: { id: { type: 'string' }, token: { type: 'string', format: 'uuid' } },
      },
      { seed: 's', testValues: { byName: { id: 'CUSTOM' }, byFormat: { uuid: 'FMT' } } },
    ) as Record<string, unknown>;
    expect(out.id).toBe('CUSTOM');
    expect(out.token).toBe('FMT');
  });

  it('terminates on circular schemas (depth limit)', () => {
    const node: Record<string, unknown> = { type: 'object', required: ['self'], properties: {} };
    (node.properties as Record<string, unknown>).self = node;
    const out = gen(node);
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
