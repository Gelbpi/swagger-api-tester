/**
 * ParamResolver + ValueSource chain (build-prompt §35, §22, §23).
 *
 * Resolves a single parameter value by consulting an ordered chain of value
 * sources. The chain is fixed for V1: SpecExample -> SpecDefault -> SpecEnum ->
 * ConfigTestValues -> FormatDefault. The architecture allows a future
 * ValuePoolSource to be inserted without changing this public interface — DO NOT
 * implement it in V1.
 *
 * Path parameters are never guessed (§22): a required free-form string with no
 * example/default/testValue/format yields no value (caller -> NO_TEST_DATA).
 */
import type { OpenAPIV3 } from 'openapi-types';
import { FIXED_UUID } from './dataGenerator.js';
import type { ValuePool } from './valuePool.js';

export type ValueSourceName =
  | 'SpecExample'
  | 'SpecDefault'
  | 'SpecEnum'
  | 'ConfigTestValues'
  | 'ValuePool'
  | 'FormatDefault';

export interface ResolvedParam {
  value: unknown;
  source: ValueSourceName;
}

export interface TestValuesByLocation {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  header?: Record<string, unknown>;
}

function schemaOf(param: OpenAPIV3.ParameterObject): Record<string, unknown> {
  return (param.schema as Record<string, unknown> | undefined) ?? {};
}

function firstExample(param: OpenAPIV3.ParameterObject): { value: unknown } | undefined {
  if (param.example !== undefined) return { value: param.example };
  if (param.examples) {
    for (const ex of Object.values(param.examples)) {
      if (ex && typeof ex === 'object' && 'value' in ex) return { value: (ex as { value: unknown }).value };
    }
  }
  const schema = schemaOf(param);
  if (schema.example !== undefined) return { value: schema.example };
  return undefined;
}

/** Unambiguous scalar default (§22). Returns undefined for free-form path strings. */
function formatDefault(param: OpenAPIV3.ParameterObject): unknown {
  const schema = schemaOf(param);
  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== 'null')
    : schema.type;
  if (type === 'integer' || type === 'number') return 1;
  if (type === 'boolean') return true;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items && Array.isArray(items.enum) && items.enum.length) return [items.enum[0]];
    return undefined;
  }
  // string (or unspecified)
  const format = typeof schema.format === 'string' ? schema.format : undefined;
  if (format === 'uuid') return FIXED_UUID;
  if (format === 'date') return '2020-01-01';
  if (format === 'date-time') return '2020-01-01T00:00:00Z';
  if (format === 'email') return 'test@example.com';
  if (format === 'uri' || format === 'url') return 'https://example.com';
  // Free-form string: never guessed for a path parameter (§22).
  if (param.in === 'path') return undefined;
  return 'test';
}

export interface ParamResolveOptions {
  testValues?: TestValuesByLocation;
  /** Values harvested from earlier responses (§36); consulted before FormatDefault. */
  pool?: ValuePool;
}

/** True if a pooled value is compatible with the parameter's declared type. */
function pooledValueFits(value: unknown, schema: Record<string, unknown>): boolean {
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'integer' || type === 'number') return typeof value === 'number';
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return true; // unspecified type -> accept
}

/** Resolve a parameter value using the ordered value-source chain. */
export function resolveParam(
  param: OpenAPIV3.ParameterObject,
  opts: ParamResolveOptions = {},
): ResolvedParam | undefined {
  // 1. SpecExample
  const ex = firstExample(param);
  if (ex) return { value: ex.value, source: 'SpecExample' };

  const schema = schemaOf(param);
  // 2. SpecDefault
  if (schema.default !== undefined) return { value: schema.default, source: 'SpecDefault' };
  // 3. SpecEnum
  if (Array.isArray(schema.enum) && schema.enum.length) {
    return { value: schema.enum[0], source: 'SpecEnum' };
  }
  // 4. ConfigTestValues
  const loc = param.in as keyof TestValuesByLocation;
  const tv = opts.testValues?.[loc]?.[param.name];
  if (tv !== undefined) return { value: tv, source: 'ConfigTestValues' };
  // 5. ValuePool — a real harvested id beats a synthetic default, and closes
  //    NO_TEST_DATA for free-form ids the format generator can't produce. Only
  //    use a pooled value whose TYPE matches the parameter (never a stray string
  //    for an integer id, etc.).
  const pooled = opts.pool?.get(param.name);
  if (pooled !== undefined && pooledValueFits(pooled, schema)) {
    return { value: pooled, source: 'ValuePool' };
  }
  // 6. FormatDefault
  const fd = formatDefault(param);
  if (fd !== undefined) return { value: fd, source: 'FormatDefault' };

  return undefined;
}

/** Sources that count as explicit enough to include an OPTIONAL parameter (§23). */
export const EXPLICIT_SOURCES: ReadonlySet<ValueSourceName> = new Set<ValueSourceName>([
  'SpecExample',
  'SpecDefault',
  'SpecEnum',
  'ConfigTestValues',
]);
