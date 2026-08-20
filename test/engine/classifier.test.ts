import { describe, expect, it } from 'vitest';
import { classifyResponse, type ClassifyInput } from '../../src/engine/execution/classifier.js';

const base: ClassifyInput = {
  expectedStatus: 200,
  actualStatus: 200,
  onlyDefault: false,
  documentedResponseKey: '200',
  contentDocumented: true,
  contentTypeOk: true,
  schemaChecked: true,
  schemaValid: true,
  hasCredentials: false,
  endpointRequiresAuth: false,
  validationErrors: [],
};

const cls = (over: Partial<ClassifyInput>) => classifyResponse({ ...base, ...over });

describe('classifyResponse (build-prompt §33)', () => {
  it('PASS when everything matches', () => {
    expect(cls({}).outcome).toBe('PASS');
  });

  it('5xx -> FAIL/SERVER_ERROR', () => {
    expect(cls({ actualStatus: 500 })).toMatchObject({ outcome: 'FAIL', reason: 'SERVER_ERROR' });
  });

  it('401 with no creds, undocumented, endpoint requires auth -> SKIPPED/AUTH_UNAVAILABLE', () => {
    expect(
      cls({ actualStatus: 401, hasCredentials: false, documentedResponseKey: undefined, endpointRequiresAuth: true }),
    ).toMatchObject({ outcome: 'SKIPPED', reason: 'AUTH_UNAVAILABLE' });
  });

  it('401 with no creds but DOCUMENTED -> INCONCLUSIVE/BUSINESS_RULE_REJECTED (login rejecting bad body)', () => {
    expect(
      cls({ actualStatus: 401, hasCredentials: false, documentedResponseKey: '401', contentDocumented: false, schemaChecked: false }),
    ).toMatchObject({ outcome: 'INCONCLUSIVE', reason: 'BUSINESS_RULE_REJECTED' });
  });

  it('401 with no creds, undocumented, NO auth requirement -> FAIL/UNDOCUMENTED_ERROR_SHAPE', () => {
    expect(
      cls({ actualStatus: 401, hasCredentials: false, documentedResponseKey: undefined, endpointRequiresAuth: false }),
    ).toMatchObject({ outcome: 'FAIL', reason: 'UNDOCUMENTED_ERROR_SHAPE' });
  });

  it('403 with creds -> INCONCLUSIVE/AUTH_INSUFFICIENT_SCOPE', () => {
    expect(cls({ actualStatus: 403, hasCredentials: true })).toMatchObject({
      outcome: 'INCONCLUSIVE',
      reason: 'AUTH_INSUFFICIENT_SCOPE',
    });
  });

  it('documented 4xx with valid shape -> INCONCLUSIVE/BUSINESS_RULE_REJECTED', () => {
    expect(cls({ actualStatus: 422, documentedResponseKey: '422', schemaValid: true })).toMatchObject({
      outcome: 'INCONCLUSIVE',
      reason: 'BUSINESS_RULE_REJECTED',
    });
  });

  it('undocumented 4xx -> FAIL/UNDOCUMENTED_ERROR_SHAPE', () => {
    expect(
      cls({ actualStatus: 422, documentedResponseKey: undefined }),
    ).toMatchObject({ outcome: 'FAIL', reason: 'UNDOCUMENTED_ERROR_SHAPE' });
  });

  it('documented 4xx with invalid body -> FAIL/UNDOCUMENTED_ERROR_SHAPE', () => {
    expect(
      cls({ actualStatus: 400, documentedResponseKey: '400', schemaChecked: true, schemaValid: false }),
    ).toMatchObject({ outcome: 'FAIL', reason: 'UNDOCUMENTED_ERROR_SHAPE' });
  });

  it('correct status, invalid body -> FAIL/SCHEMA_VALIDATION_FAILED', () => {
    expect(cls({ schemaValid: false })).toMatchObject({
      outcome: 'FAIL',
      reason: 'SCHEMA_VALIDATION_FAILED',
    });
  });

  it('correct status, content type mismatch -> FAIL/CONTENT_TYPE_MISMATCH', () => {
    expect(cls({ contentTypeOk: false })).toMatchObject({
      outcome: 'FAIL',
      reason: 'CONTENT_TYPE_MISMATCH',
    });
  });

  it('unexpected undocumented success -> FAIL/STATUS_MISMATCH', () => {
    expect(
      cls({ expectedStatus: 201, actualStatus: 200, documentedResponseKey: undefined, contentDocumented: false, schemaChecked: false }),
    ).toMatchObject({ outcome: 'FAIL', reason: 'STATUS_MISMATCH' });
  });

  it('documented alternate 2xx passes even if != expected', () => {
    expect(
      cls({ expectedStatus: 201, actualStatus: 200, documentedResponseKey: '200' }),
    ).toMatchObject({ outcome: 'PASS' });
  });
});
