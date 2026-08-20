import { afterEach, describe, expect, it } from 'vitest';
import {
  hasSecretPlaceholder,
  resolveSecrets,
  SecretResolutionError,
} from '../../src/engine/auth/secrets.js';
import { maskString, resetRegisteredSecrets } from '../../src/engine/results/sanitizer.js';

afterEach(() => {
  resetRegisteredSecrets();
  delete process.env.APITESTER_TEST_SECRET;
});

describe('secret placeholders (build-prompt §14)', () => {
  it('detects placeholders', () => {
    expect(hasSecretPlaceholder('Bearer ${env:X}')).toBe(true);
    expect(hasSecretPlaceholder('plain')).toBe(false);
  });

  it('resolves ${env:NAME} and registers it for masking', async () => {
    process.env.APITESTER_TEST_SECRET = 'topsecret-42';
    const resolved = await resolveSecrets('token=${env:APITESTER_TEST_SECRET}');
    expect(resolved).toBe('token=topsecret-42');
    // Registered as a secret, so it can no longer appear in any output.
    expect(maskString('leak topsecret-42 here')).not.toContain('topsecret-42');
  });

  it('throws when an env var is missing', async () => {
    await expect(resolveSecrets('${env:DEFINITELY_NOT_SET_XYZ}')).rejects.toBeInstanceOf(
      SecretResolutionError,
    );
  });

  it('rejects a malformed keychain reference', async () => {
    await expect(resolveSecrets('${keychain:noaccount}')).rejects.toBeInstanceOf(
      SecretResolutionError,
    );
  });

  it('returns strings without placeholders unchanged', async () => {
    expect(await resolveSecrets('http://localhost:8080')).toBe('http://localhost:8080');
  });
});
