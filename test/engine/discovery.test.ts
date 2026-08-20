import { describe, expect, it } from 'vitest';
import {
  PROBE_PATHS,
  candidateSpecUrls,
  resolveUrl,
} from '../../src/engine/openapi/discovery.js';

describe('discovery (build-prompt §16)', () => {
  it('uses openApiUrl directly (absolute and relative)', () => {
    expect(candidateSpecUrls('http://localhost:8080', 'http://api/x')).toEqual(['http://api/x']);
    expect(candidateSpecUrls('http://localhost:8080', '/custom/spec')).toEqual([
      'http://localhost:8080/custom/spec',
    ]);
  });

  it('probes the fixed ordered path list when no openApiUrl', () => {
    const urls = candidateSpecUrls('http://localhost:8080');
    expect(urls[0]).toBe('http://localhost:8080/v3/api-docs');
    expect(urls).toHaveLength(PROBE_PATHS.length);
    expect(urls).toContain('http://localhost:8080/swagger.json');
  });

  it('resolveUrl joins relative refs against a base with a path', () => {
    expect(resolveUrl('http://h:8080/v3/api-docs/swagger-config', '/v3/api-docs/groupA')).toBe(
      'http://h:8080/v3/api-docs/groupA',
    );
    expect(resolveUrl('http://h:8080', 'https://other/spec')).toBe('https://other/spec');
  });
});
