/**
 * Configuration schema (build-prompt §13).
 *
 * `config.json` is the authoritative source. Unknown keys are errors (the loader
 * turns them into actionable "did you mean" suggestions). `seed`, `teardown`,
 * and `smartValues` are reserved: accepted for forward-compatibility but NOT
 * executed in V1 — the loader emits a warning when they are present.
 */
import { z } from 'zod';

export const AUTH_PROFILE_TYPES = ['bearer', 'basic', 'apikey', 'cookie', 'login'] as const;

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
/**
 * A profile that authenticates dynamically: POST credentials to a login endpoint,
 * extract the token from the response (via a JSON pointer), cache it, and refresh
 * on 401 (build-prompt §25 login/bootstrap — a V2 extension of the AuthManager seam).
 */
const loginProfile = z.object({
  type: z.literal('login'),
  /** Login endpoint; absolute, or relative to baseUrl. */
  loginUrl: z.string(),
  method: z.enum(['POST', 'PUT', 'GET']).optional(),
  contentType: z.enum(['application/json', 'application/x-www-form-urlencoded']).optional(),
  /** Credentials body (values may use ${env:}/${keychain:}). */
  body: z.record(z.unknown()).optional(),
  /** JSON pointer to the token in the response, e.g. "/token" or "/data/accessToken". */
  tokenPath: z.string(),
  /** Header name (default Authorization) and format (default "Bearer {token}"). */
  headerName: z.string().optional(),
  headerFormat: z.string().optional(),
});

export const authProfileSchema = z.discriminatedUnion('type', [
  bearerProfile,
  basicProfile,
  apiKeyProfile,
  cookieProfile,
  loginProfile,
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
    /** Strict (default) fails an unexpected 2xx; false treats it as PASS (§#8). */
    strictStatus: z.boolean().optional(),
    /** Varies deterministic data generation between runs (§#11 seed). */
    seed: z.union([z.string(), z.number()]).optional(),
    /**
     * After a mutation run, delete resources the tester created (compensating
     * DELETEs, reverse order) so the DB stays clean and runs are repeatable.
     * Requires mutations enabled; only ever deletes ids we created (§#11 teardown).
     */
    teardown: z.boolean().optional(),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;

/** Reserved (accepted, not executed in V1). */
export const RESERVED_KEYS = ['smartValues'] as const;

export const configSchema = settingsSchema
  .extend({
    profiles: z.record(settingsSchema.partial()).optional(),
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
