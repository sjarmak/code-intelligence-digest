import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isValidAdminToken, requireAdminToken } from '@/src/lib/auth/admin-token';

const TOKEN = 'test-admin-token-12345';

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set('authorization', authHeader);
  return new Request('http://localhost/api/admin/populate-embeddings', {
    method: 'POST',
    headers,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isValidAdminToken', () => {
  it('returns false when ADMIN_API_TOKEN is not configured', () => {
    vi.stubEnv('ADMIN_API_TOKEN', '');
    expect(isValidAdminToken(`Bearer ${TOKEN}`)).toBe(false);
  });

  it('returns false when the header is missing', () => {
    vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
    expect(isValidAdminToken(null)).toBe(false);
    expect(isValidAdminToken(undefined)).toBe(false);
  });

  it('returns false when the token does not match', () => {
    vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
    expect(isValidAdminToken('Bearer wrong-token')).toBe(false);
  });

  it('returns false when the scheme is not Bearer', () => {
    vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
    expect(isValidAdminToken(TOKEN)).toBe(false);
    expect(isValidAdminToken(`Basic ${TOKEN}`)).toBe(false);
  });

  it('returns false for a token that is a prefix of the real token', () => {
    vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
    expect(isValidAdminToken(`Bearer ${TOKEN.slice(0, -1)}`)).toBe(false);
  });

  it('returns true for a matching Bearer token', () => {
    vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
    expect(isValidAdminToken(`Bearer ${TOKEN}`)).toBe(true);
  });
});

describe('requireAdminToken', () => {
  describe('in production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('returns 401 when no token is configured (fail closed)', () => {
      vi.stubEnv('ADMIN_API_TOKEN', '');
      const res = requireAdminToken(makeRequest(`Bearer ${TOKEN}`));
      expect(res?.status).toBe(401);
    });

    it('returns 401 when the header is missing or wrong', () => {
      vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
      expect(requireAdminToken(makeRequest())?.status).toBe(401);
      expect(requireAdminToken(makeRequest('Bearer nope'))?.status).toBe(401);
    });

    it('allows a valid token', () => {
      vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
      expect(requireAdminToken(makeRequest(`Bearer ${TOKEN}`))).toBeNull();
    });
  });

  describe('outside production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'test');
    });

    it('allows requests without a token (dev convenience)', () => {
      vi.stubEnv('ADMIN_API_TOKEN', '');
      expect(requireAdminToken(makeRequest())).toBeNull();
    });

    it('still rejects an explicitly wrong token when one is configured', () => {
      vi.stubEnv('ADMIN_API_TOKEN', TOKEN);
      expect(requireAdminToken(makeRequest('Bearer nope'))?.status).toBe(401);
    });
  });
});
