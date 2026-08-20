import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { normalizeSchema } from '../../src/engine/openapi/schemaNormalizer.js';

function compilable(schema: unknown): boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.compile(normalizeSchema(schema));
  return true;
}

describe('SchemaNormalizer (build-prompt §17)', () => {
  it('nullable string -> type ["string","null"]', () => {
    const out = normalizeSchema({ type: 'string', nullable: true }) as Record<string, unknown>;
    expect(out.type).toEqual(['string', 'null']);
    expect('nullable' in out).toBe(false);
  });

  it('nullable without type -> anyOf with {type:null}', () => {
    const out = normalizeSchema({ oneOf: [{ type: 'string' }], nullable: true }) as Record<
      string,
      unknown
    >;
    expect(Array.isArray(out.anyOf)).toBe(true);
  });

  it('boolean exclusiveMinimum -> numeric', () => {
    const out = normalizeSchema({ type: 'number', minimum: 5, exclusiveMinimum: true }) as Record<
      string,
      unknown
    >;
    expect(out.exclusiveMinimum).toBe(5);
    expect('minimum' in out).toBe(false);
  });

  it('exclusiveMinimum:false keeps minimum inclusive', () => {
    const out = normalizeSchema({ type: 'number', minimum: 5, exclusiveMinimum: false }) as Record<
      string,
      unknown
    >;
    expect(out.minimum).toBe(5);
    expect('exclusiveMinimum' in out).toBe(false);
  });

  it('strips OpenAPI-only keywords (discriminator, xml, example)', () => {
    const out = normalizeSchema({
      type: 'object',
      discriminator: { propertyName: 'kind' },
      xml: { name: 'x' },
      example: { a: 1 },
      properties: { a: { type: 'integer', example: 3 } },
    }) as Record<string, unknown>;
    expect('discriminator' in out).toBe(false);
    expect('xml' in out).toBe(false);
    expect('example' in out).toBe(false);
    expect('example' in (out.properties as Record<string, Record<string, unknown>>).a!).toBe(false);
  });

  it('recurses through allOf/anyOf/oneOf/items/additionalProperties', () => {
    const out = normalizeSchema({
      allOf: [{ type: 'string', nullable: true }],
      items: { type: 'integer', minimum: 0, exclusiveMinimum: true },
      additionalProperties: { type: 'string', nullable: true },
    }) as Record<string, unknown>;
    expect((out.allOf as Record<string, unknown>[])[0]!.type).toEqual(['string', 'null']);
    expect((out.items as Record<string, unknown>).exclusiveMinimum).toBe(0);
    expect((out.additionalProperties as Record<string, unknown>).type).toEqual(['string', 'null']);
  });

  it('handles circular schemas with a depth cap and stays Ajv-compilable', () => {
    const node: Record<string, unknown> = { type: 'object', properties: {} };
    (node.properties as Record<string, unknown>).self = node; // cycle
    const normalized = normalizeSchema(node);
    expect(() => JSON.stringify(normalized)).not.toThrow(); // finite, acyclic
    expect(compilable(node)).toBe(true);
  });

  it('OpenAPI 3.1-style schemas pass through and compile', () => {
    expect(
      compilable({ type: ['string', 'null'], minLength: 1, examples: ['a'] }),
    ).toBe(true);
  });

  it('produces schemas that validate real data', () => {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(
      normalizeSchema({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          age: { type: 'integer', minimum: 0, exclusiveMinimum: false },
          email: { type: 'string', format: 'email', nullable: true },
        },
      }),
    );
    expect(validate({ name: 'bob', age: 3, email: null })).toBe(true);
    expect(validate({ age: -1 })).toBe(false);
  });
});
