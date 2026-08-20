/**
 * Risk classification (build-prompt §26).
 *
 * READ         GET / HEAD / OPTIONS
 * DESTRUCTIVE  DELETE, or path/operationId matching purge-like patterns
 * SIDE_EFFECTING path/operationId/summary/tags matching send-like patterns
 * MUTATING     other writes (POST/PUT/PATCH)
 *
 * Precedence: DESTRUCTIVE > SIDE_EFFECTING > MUTATING > READ.
 */
import type { Endpoint } from '../types/endpoint.js';

export type RiskClass = 'READ' | 'MUTATING' | 'DESTRUCTIVE' | 'SIDE_EFFECTING';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const DESTRUCTIVE_PATTERN = /purge|truncate|wipe|drop|delete[-_]?all|destroy|erase/i;
// Verb-like send patterns. Read methods are never side-effecting, so resource
// nouns like "payments"/"orders" on a GET do not trigger this.
const SIDE_EFFECT_PATTERN =
  /send|email|e-mail|sms|notify|notification|charge|\bpay\b|publish|dispatch|webhook|mail|invite|refund|transfer|checkout/i;

export function classifyRisk(endpoint: Endpoint): RiskClass {
  const isRead = READ_METHODS.has(endpoint.method);
  const haystackCore = `${endpoint.path} ${endpoint.operationId ?? ''}`;
  const haystackWide = `${haystackCore} ${endpoint.summary ?? ''} ${endpoint.tags.join(' ')}`;

  if (endpoint.method === 'DELETE') return 'DESTRUCTIVE';
  // Keyword-based risk applies only to state-changing methods; a GET is a read.
  if (!isRead && DESTRUCTIVE_PATTERN.test(haystackCore)) return 'DESTRUCTIVE';
  if (!isRead && SIDE_EFFECT_PATTERN.test(haystackWide)) return 'SIDE_EFFECTING';
  if (WRITE_METHODS.has(endpoint.method)) return 'MUTATING';
  if (isRead) return 'READ';
  return 'MUTATING';
}
