/**
 * Deterministic DataGenerator (build-prompt §20).
 *
 * Generates a request value for an OpenAPI/JSON-Schema node. HARD requirement:
 * the same (spec, operation, field) always yields the same value — all variation
 * comes from a seed, never Math.random().
 *
 * Priority: example -> default -> enum -> const -> config.testValues ->
 * format-aware generator -> constraint-respecting type generator.
 *
 * Constraints honored: minLength, maxLength, minimum, maximum, multipleOf,
 * minItems, maxItems, uniqueItems, pattern, nullable, required. Combinators:
 * allOf (merged), oneOf/anyOf (first branch), $ref (already dereferenced),
 * circular refs (depth-limited).
 */
import RandExp from 'randexp';
import { rngFor } from './random.js';

/** A deterministic UUID used wherever a uuid-format value is needed (§22). */
export const FIXED_UUID = '11111111-1111-1111-1111-111111111111';

export interface TestValuesLookup {
  /** Values keyed by field/property name. */
  byName?: Record<string, unknown>;
  /** Values keyed by string format (email, uuid, ...). */
  byFormat?: Record<string, unknown>;
}

export interface GenerateOptions {
  /** Base seed, typically operationId + json-pointer. */
  seed: string;
  testValues?: TestValuesLookup;
  maxDepth?: number;
}

interface Ctx {
  seed: string;
  pointer: string;
  depth: number;
  maxDepth: number;
  fieldName?: string;
  ancestors: Set<object>;
  testValues?: TestValuesLookup;
}

type Schema = Record<string, unknown>;

function isObj(v: unknown): v is Schema {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function hasExplicitSource(s: unknown): boolean {
  if (!isObj(s)) return false;
  return (
    s.example !== undefined ||
    s.default !== undefined ||
    (Array.isArray(s.enum) && s.enum.length > 0) ||
    s.const !== undefined
  );
}

/** Shallow-merge allOf branches into one object schema. */
function mergeAllOf(base: Schema): Schema {
  const branches = base.allOf as unknown[];
  const merged: Schema = {};
  const properties: Schema = {};
  const required = new Set<string>();
  const consider = [...branches, { ...base, allOf: undefined }];
  for (const b of consider) {
    if (!isObj(b)) continue;
    for (const [k, v] of Object.entries(b)) {
      if (k === 'allOf' || v === undefined) continue;
      if (k === 'properties' && isObj(v)) Object.assign(properties, v);
      else if (k === 'required' && Array.isArray(v)) v.forEach((r) => required.add(String(r)));
      else merged[k] = v;
    }
  }
  if (Object.keys(properties).length) merged.properties = properties;
  if (required.size) merged.required = [...required];
  return merged;
}

function resolveType(s: Schema): string {
  const t = s.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const nonNull = t.find((x) => x !== 'null');
    return typeof nonNull === 'string' ? nonNull : 'null';
  }
  if (isObj(s.properties) || s.additionalProperties !== undefined) return 'object';
  if (s.items !== undefined) return 'array';
  if (Array.isArray(s.enum) && s.enum.length) return typeof s.enum[0] === 'number' ? 'number' : 'string';
  return 'string';
}

function formatValue(format: string, ctx: Ctx): string {
  switch (format) {
    case 'uuid':
      return FIXED_UUID;
    case 'email':
      return 'test@example.com';
    case 'date':
      return '2020-01-01';
    case 'date-time':
      return '2020-01-01T00:00:00Z';
    case 'uri':
    case 'url':
      return 'https://example.com';
    case 'hostname':
      return 'example.com';
    case 'ipv4':
      return '192.0.2.1';
    case 'ipv6':
      return '2001:db8::1';
    case 'password':
      return 'Passw0rd!';
    case 'byte':
      return 'ZXhhbXBsZQ==';
    case 'binary':
      return 'binary-data';
    default:
      return `str-${(rngFor(ctx.seed + ctx.pointer)() * 1e6).toFixed(0)}`;
  }
}

function genString(s: Schema, ctx: Ctx): string {
  if (typeof s.pattern === 'string') {
    const rand = rngFor(ctx.seed + ctx.pointer + ':pattern');
    const rx = new RandExp(s.pattern);
    rx.randInt = (from: number, to: number) => from + Math.floor(rand() * (to - from + 1));
    return rx.gen();
  }
  if (typeof s.format === 'string') return formatValue(s.format, ctx);
  let value = 'string';
  const min = typeof s.minLength === 'number' ? s.minLength : 0;
  const max = typeof s.maxLength === 'number' ? s.maxLength : undefined;
  while (value.length < min) value += 'x';
  if (max !== undefined && value.length > max) value = value.slice(0, max);
  return value;
}

function genNumber(s: Schema, isInt: boolean): number {
  const step = isInt ? 1 : 1;
  let v: number;
  if (typeof s.minimum === 'number') v = s.minimum;
  else if (typeof s.exclusiveMinimum === 'number') v = s.exclusiveMinimum + step;
  else v = 1;
  if (typeof s.exclusiveMinimum === 'number' && v <= s.exclusiveMinimum) v = s.exclusiveMinimum + step;
  if (typeof s.multipleOf === 'number' && s.multipleOf > 0) {
    v = Math.ceil(v / s.multipleOf) * s.multipleOf;
  }
  if (typeof s.maximum === 'number' && v > s.maximum) v = s.maximum;
  if (typeof s.exclusiveMaximum === 'number' && v >= s.exclusiveMaximum) v = s.exclusiveMaximum - step;
  return isInt ? Math.trunc(v) : v;
}

function genArray(s: Schema, ctx: Ctx): unknown[] {
  const items = isObj(s.items) ? s.items : {};
  let count = typeof s.minItems === 'number' ? s.minItems : 1;
  if (typeof s.maxItems === 'number' && count > s.maxItems) count = s.maxItems;
  if (count === 0 && typeof s.minItems !== 'number') count = 1;
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    let value = gen(items, { ...ctx, pointer: `${ctx.pointer}/${i}`, depth: ctx.depth + 1 });
    if (s.uniqueItems === true && out.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
      value = typeof value === 'string' ? `${value}-${i}` : typeof value === 'number' ? value + i : value;
    }
    out.push(value);
  }
  return out;
}

function genObject(s: Schema, ctx: Ctx): Record<string, unknown> {
  const props = isObj(s.properties) ? s.properties : {};
  const required = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(props).sort()) {
    const childSchema = props[name];
    if (!required.has(name) && !hasExplicitSource(childSchema)) continue;
    out[name] = gen(childSchema, {
      ...ctx,
      pointer: `${ctx.pointer}/${name}`,
      depth: ctx.depth + 1,
      fieldName: name,
    });
  }
  return out;
}

function gen(schema: unknown, ctx: Ctx): unknown {
  if (schema === true || schema === undefined || schema === null) return {};
  if (schema === false) return null;
  if (!isObj(schema)) return null;

  let s = schema;
  if (Array.isArray(s.allOf)) s = mergeAllOf(s);
  if (Array.isArray(s.oneOf) && s.oneOf.length) return gen(s.oneOf[0], ctx);
  if (Array.isArray(s.anyOf) && s.anyOf.length) return gen(s.anyOf[0], ctx);

  // Priority sources.
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (s.const !== undefined) return s.const;
  if (ctx.fieldName && ctx.testValues?.byName && ctx.fieldName in ctx.testValues.byName) {
    return ctx.testValues.byName[ctx.fieldName];
  }
  if (typeof s.format === 'string' && ctx.testValues?.byFormat && s.format in ctx.testValues.byFormat) {
    return ctx.testValues.byFormat[s.format];
  }

  // Cycle / depth guard (§20).
  if (ctx.ancestors.has(s) || ctx.depth > ctx.maxDepth) return null;
  ctx.ancestors.add(s);
  try {
    switch (resolveType(s)) {
      case 'object':
        return genObject(s, ctx);
      case 'array':
        return genArray(s, ctx);
      case 'integer':
        return genNumber(s, true);
      case 'number':
        return genNumber(s, false);
      case 'boolean':
        return true;
      case 'null':
        return null;
      default:
        return genString(s, ctx);
    }
  } finally {
    ctx.ancestors.delete(s);
  }
}

/** Generate a deterministic value for a schema. */
export function generateValue(schema: unknown, opts: GenerateOptions): unknown {
  return gen(schema, {
    seed: opts.seed,
    pointer: '',
    depth: 0,
    maxDepth: opts.maxDepth ?? 24,
    ancestors: new Set<object>(),
    ...(opts.testValues ? { testValues: opts.testValues } : {}),
  });
}
