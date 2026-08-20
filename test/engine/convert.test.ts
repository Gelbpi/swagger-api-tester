import { describe, expect, it } from 'vitest';
import { convertSwagger2 } from '../../src/engine/openapi/convert.js';

describe('convertSwagger2 (build-prompt §16)', () => {
  it('converts a minimal Swagger 2.0 document to OpenAPI 3.0', async () => {
    const swagger2 = {
      swagger: '2.0',
      info: { title: 'T', version: '1.0.0' },
      paths: {
        '/ping': {
          get: { responses: { '200': { description: 'ok' } } },
        },
      },
    };
    const out = await convertSwagger2(swagger2);
    expect(out.openapi.startsWith('3.0')).toBe(true);
    expect(out.paths?.['/ping']).toBeDefined();
  });
});
