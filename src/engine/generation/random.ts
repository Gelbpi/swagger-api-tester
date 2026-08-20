/**
 * Deterministic pseudo-randomness (build-prompt §20).
 *
 * Math.random() is FORBIDDEN. All variation is derived from a seed string, so
 * the same spec + operation + field always produces the same value. The seed is
 * hash(operationId + jsonPointer + fieldName).
 */
import { createHash } from 'node:crypto';

/** Stable 32-bit unsigned hash of a seed string (from a SHA-256 prefix). */
export function hash32(input: string): number {
  const digest = createHash('sha256').update(input, 'utf8').digest();
  return digest.readUInt32BE(0) >>> 0;
}

/** mulberry32 PRNG — small, fast, fully determined by its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a deterministic [0,1) generator for a given seed string. */
export function rngFor(seedString: string): () => number {
  return mulberry32(hash32(seedString));
}
