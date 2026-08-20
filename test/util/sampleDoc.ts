import type { OpenApiDocument } from '../../src/engine/types/openapi.js';

/** A small dereferenced-style OpenAPI 3.0 document for registry/matcher tests. */
export const sampleDoc = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  components: {
    parameters: {
      IdParam: { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
    },
  },
  paths: {
    '/users': {
      get: { operationId: 'listUsers', tags: ['users'], responses: { '200': { description: 'ok' } } },
      post: {
        operationId: 'createUser',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'created' } },
      },
    },
    '/users/{id}': {
      parameters: [{ $ref: '#/components/parameters/IdParam' }],
      get: { operationId: 'getUser', responses: { '200': { description: 'ok' } } },
      delete: { operationId: 'deleteUser', deprecated: true, responses: { '204': { description: 'gone' } } },
    },
    '/users/{id}/orders': {
      parameters: [{ $ref: '#/components/parameters/IdParam' }],
      get: {
        operationId: 'listOrders',
        parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
} as unknown as OpenApiDocument;
