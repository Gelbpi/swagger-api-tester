import { describe, expect, it } from 'vitest';
import {
  detectVersion,
  isSpecLike,
  isSwaggerConfig,
  parseSpecText,
} from '../../src/engine/openapi/parse.js';
import { EngineError } from '../../src/engine/types/errors.js';

describe('parseSpecText (build-prompt §16)', () => {
  it('parses JSON', () => {
    expect(parseSpecText('{"openapi":"3.0.0"}')).toEqual({ openapi: '3.0.0' });
  });
  it('parses YAML when JSON fails', () => {
    expect(parseSpecText('openapi: 3.0.0\ninfo:\n  title: X')).toMatchObject({
      openapi: '3.0.0',
      info: { title: 'X' },
    });
  });
  it('throws SPEC_INVALID on garbage', () => {
    expect(() => parseSpecText('<html>not a spec</html>')).toThrowError(EngineError);
  });
});

describe('detectVersion', () => {
  it('detects 2.0 / 3.0 / 3.1', () => {
    expect(detectVersion({ swagger: '2.0' })).toBe('2.0');
    expect(detectVersion({ openapi: '3.0.3' })).toBe('3.0');
    expect(detectVersion({ openapi: '3.1.0' })).toBe('3.1');
  });
  const reasonOf = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      return (e as EngineError).reason;
    }
    throw new Error('expected throw');
  };
  it('rejects unsupported versions', () => {
    expect(reasonOf(() => detectVersion({ openapi: '4.0.0' }))).toBe('SPEC_UNSUPPORTED_VERSION');
    expect(reasonOf(() => detectVersion({ swagger: '1.2' }))).toBe('SPEC_UNSUPPORTED_VERSION');
  });
  it('rejects non-specs as SPEC_INVALID', () => {
    expect(reasonOf(() => detectVersion({ foo: 'bar' }))).toBe('SPEC_INVALID');
  });
});

describe('shape detectors', () => {
  it('isSwaggerConfig / isSpecLike', () => {
    expect(isSwaggerConfig({ urls: [{ url: '/a' }] })).toBe(true);
    expect(isSwaggerConfig({ configUrl: '/x' })).toBe(true);
    expect(isSwaggerConfig({ openapi: '3.0.0' })).toBe(false);
    expect(isSpecLike({ openapi: '3.0.0' })).toBe(true);
    expect(isSpecLike({ swagger: '2.0' })).toBe(true);
    expect(isSpecLike({ urls: [] })).toBe(false);
  });
});
