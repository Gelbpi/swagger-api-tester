/**
 * A real Fastify mock API (build-prompt §44) used to exercise the engine over
 * actual loopback HTTP — no injected fetchers.
 */
import Fastify, { type FastifyInstance } from 'fastify';

export const mockSpec = {
  openapi: '3.0.0',
  info: { title: 'Mock API', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: { id: { type: 'integer' }, name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/broken': {
      get: {
        operationId: 'broken',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
            },
          },
        },
      },
    },
    '/boom': { get: { operationId: 'boom', responses: { '200': { description: 'ok' } } } },
    '/slow': { get: { operationId: 'slow', responses: { '200': { description: 'ok' } } } },
    '/payments': {
      get: {
        operationId: 'listPayments',
        responses: {
          '422': {
            description: 'business rule',
            content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
          },
        },
      },
    },
  },
};

export async function startMockApi(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = Fastify();

  app.get('/openapi.json', async () => mockSpec);
  app.get('/users/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { id: Number(id), name: 'user-' + id };
  });
  app.get('/broken', async () => ({ id: 'not-an-integer' }));
  app.get('/boom', async (_req, reply) => {
    await reply.code(500).send({ message: 'kaboom' });
  });
  app.get('/slow', async (_req, reply) => {
    await new Promise((r) => setTimeout(r, 1500));
    await reply.send({ ok: true });
  });
  app.get('/payments', async (_req, reply) => {
    await reply.code(422).send({ error: 'validation failed' });
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
