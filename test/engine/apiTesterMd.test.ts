import { describe, expect, it } from 'vitest';
import { parseApiTesterMd } from '../../src/engine/project/apiTesterMd.js';
import { MASK } from '../../src/engine/results/sanitizer.js';

describe('parseApiTesterMd (build-prompt §15)', () => {
  it('parses recognized sections', () => {
    const md = [
      '## Base URL',
      '```',
      'http://localhost:8080',
      '```',
      '## OpenAPI',
      'http://localhost:8080/v3/api-docs',
      '## Skip',
      '- DELETE /api/users/{id}',
      '- POST /api/admin/purge',
      '## Test Values',
      '```json',
      '{ "path": { "id": 1 } }',
      '```',
      '## Notes',
      'be careful',
    ].join('\n');
    const parsed = parseApiTesterMd(md);
    expect(parsed.baseUrl).toBe('http://localhost:8080');
    expect(parsed.openApiUrl).toBe('http://localhost:8080/v3/api-docs');
    expect(parsed.skip).toEqual(['DELETE /api/users/{id}', 'POST /api/admin/purge']);
    expect(parsed.testValues).toEqual({ path: { id: 1 } });
    expect(parsed.notes).toBe('be careful');
    expect(parsed.warnings).toEqual([]);
  });

  it('truncates notes to ~500 chars', () => {
    const parsed = parseApiTesterMd('## Notes\n' + 'x'.repeat(1000));
    expect(parsed.notes!.length).toBeLessThanOrEqual(501);
    expect(parsed.notes!.endsWith('…')).toBe(true);
  });

  it('masks credential-like content and warns', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const parsed = parseApiTesterMd(`## Notes\ntoken is ${jwt}`);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.notes).toContain(MASK);
    expect(parsed.notes).not.toContain(jwt);
  });
});
