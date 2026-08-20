/**
 * Configuration schema (build-prompt §13).
 *
 * `config.json` is the authoritative source. Unknown keys are errors (the loader
 * turns them into actionable "did you mean" suggestions). `seed`, `teardown`,
 * and `smartValues` are reserved: accepted for forward-compatibility but NOT
 * executed in V1 — the loader emits a warning when they are present.
 */
import { z } from 'zod';

export const AUTH_PROFILE_TYPES = ['bearer', 'basic', 'apikey', 'cookie'] as const;

const bearerProfile = z.object({
  type: z.literal('bearer'),
  token: z.string(),
});
const basicProfile = z.object({
  type: z.literal('basic'),
  username: z.string(),
  password: z.string(),
});
const apiKeyProfile = z.object({
  type: z.literal('apikey'),
  in: z.enum(['header', 'query', 'cookie']),
  name: z.string(),
  value: z.string(),
});
const cookieProfile = z.object({
  type: z.literal('cookie'),
  name: z.string().optional(),
  value: z.string(),
});

export const authProfileSchema = z.discriminatedUnion('type', [
  bearerProfile,
  basicProfile,
  apiKeyProfile,
  cookieProfile,
]);
export type AuthProfile = z.infer<typeof authProfileSchema>;

const testValuesSchema = z
  .object({
    path: z.record(z.unknown()).optional(),
    query: z.record(z.unknown()).optional(),
    header: z.record(z.unknown()).optional(),
    body: z.record(z.unknown()).optional(),
    byFormat: z.record(z.unknown()).optional(),
  })
  .strict();

const requestOverrideSchema = z
  .object({
    headers: z.record(z.string()).optional(),
    query: z.record(z.unknown()).optional(),
    pathParams: z.record(z.unknown()).optional(),
    body: z.unknown().optional(),
  })
  .strict();

/** Operational settings — the keys that a `profiles` entry may also override. */
export const settingsSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    openApiUrl: z.string().optional(),
    maxParallelRequests: z.number().int().positive().max(64).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
    mutations: z.boolean().optional(),
    allowSideEffecting: z.boolean().optional(),
    allowRemoteTargets: z.boolean().optional(),
    allowInsecureTls: z.boolean().optional(),
    defaultAuthProfile: z.string().optional(),
    auth: z
      .object({ profiles: z.record(authProfileSchema) })
      .strict()
      .optional(),
    testValues: testValuesSchema.optional(),
    requestOverrides: z.record(requestOverrideSchema).optional(),
    expectations: z.record(z.number().int().min(100).max(599)).optional(),
    skip: z.array(z.string()).optional(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;

/** Reserved (accepted, not executed in V1). */
export const RESERVED_KEYS = ['seed', 'teardown', 'smartValues'] as const;

export const configSchema = settingsSchema
  .extend({
    profiles: z.record(settingsSchema.partial()).optional(),
    seed: z.unknown().optional(),
    teardown: z.unknown().optional(),
    smartValues: z.unknown().optional(),
  })
  .strict();
export type ApiTesterConfig = z.infer<typeof configSchema>;

/** All recognized top-level keys — used to generate suggestions for typos. */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = [
  ...Object.keys(settingsSchema.shape),
  'profiles',
  ...RESERVED_KEYS,
];
