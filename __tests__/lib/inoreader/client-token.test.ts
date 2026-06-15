/**
 * Tests for Inoreader refresh-token rotation in InoreaderClient.getAccessToken (bd-mp5).
 *
 * Inoreader rotates the refresh token on every /oauth2/token call. Before bd-mp5
 * the client saved only the access_token and discarded the rotated refresh_token,
 * so after one rotation the env-var-stored token went stale and refreshes failed
 * with invalid_grant. These tests lock in the fix:
 *   - read-through from the DB, falling back to the env var      (criterion 2)
 *   - write the rotated refresh_token back to the DB             (criterion 3)
 *   - log/alert on refresh failure                               (criterion 4)
 *
 * The oauth_tokens persistence module is mocked and global.fetch is stubbed, so
 * the tests are deterministic and need no live Postgres or network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

const { getStoredMock, storeMock, seedMock } = vi.hoisted(() => ({
  getStoredMock: vi.fn(),
  storeMock: vi.fn(),
  seedMock: vi.fn(),
}));

vi.mock('@/src/lib/db/oauth-tokens', () => ({
  getStoredRefreshToken: getStoredMock,
  storeRefreshToken: storeMock,
  seedRefreshTokenIfMissing: seedMock,
}));

import { InoreaderClient } from '@/src/lib/inoreader/client';
import { logger } from '@/src/lib/logger';

interface MockResponseOptions {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}

function mockResponse({ ok, status, statusText, body }: MockResponseOptions): Response {
  return {
    ok,
    status: status ?? (ok ? 200 : 400),
    statusText: statusText ?? (ok ? 'OK' : 'Bad Request'),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function tokenBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'AT',
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'read',
    ...overrides,
  };
}

/** Read the refresh_token that the client sent in the /oauth2/token request body. */
function sentRefreshToken(fetchMock: Mock): string | null {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return (init.body as URLSearchParams).get('refresh_token');
}

/** Invoke the private getAccessToken() on a fresh client (uncached) instance. */
function getAccessToken(client: InoreaderClient): Promise<string> {
  return (client as unknown as { getAccessToken(): Promise<string> }).getAccessToken();
}

const ORIGINAL_ENV = { ...process.env };

describe('InoreaderClient token rotation (bd-mp5)', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    getStoredMock.mockReset();
    storeMock.mockReset().mockResolvedValue(undefined);
    seedMock.mockReset().mockResolvedValue(undefined);

    process.env.INOREADER_CLIENT_ID = 'cid';
    process.env.INOREADER_CLIENT_SECRET = 'csecret';
    delete process.env.INOREADER_REFRESH_TOKEN;

    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads the refresh token from the DB and uses it (criterion 2)', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'stored-rt' }) }));

    const token = await getAccessToken(new InoreaderClient());

    expect(token).toBe('AT');
    expect(fetchMock.mock.calls[0][0]).toContain('https://www.inoreader.com/oauth2/token');
    expect(sentRefreshToken(fetchMock)).toBe('stored-rt');
    expect(seedMock).not.toHaveBeenCalled();
    expect(storeMock).not.toHaveBeenCalled();
  });

  it('seeds the env refresh token into the DB when no row exists yet (criterion 2)', async () => {
    getStoredMock.mockResolvedValue(null);
    process.env.INOREADER_REFRESH_TOKEN = 'env-rt';
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'env-rt' }) }));

    const token = await getAccessToken(new InoreaderClient());

    expect(token).toBe('AT');
    expect(seedMock).toHaveBeenCalledWith('inoreader', 'env-rt');
    expect(sentRefreshToken(fetchMock)).toBe('env-rt');
  });

  it('persists the rotated refresh token returned by Inoreader (criterion 3)', async () => {
    getStoredMock.mockResolvedValue('old-rt');
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'new-rt' }) }));

    await getAccessToken(new InoreaderClient());

    expect(storeMock).toHaveBeenCalledWith('inoreader', 'new-rt');
  });

  it('does not re-persist when the refresh token is unchanged (criterion 3)', async () => {
    getStoredMock.mockResolvedValue('same-rt');
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'same-rt' }) }));

    await getAccessToken(new InoreaderClient());

    expect(storeMock).not.toHaveBeenCalled();
  });

  it('falls back to the env var when the DB read fails (criterion 2)', async () => {
    getStoredMock.mockRejectedValue(new Error('db down'));
    process.env.INOREADER_REFRESH_TOKEN = 'env-rt';
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'env-rt' }) }));

    const token = await getAccessToken(new InoreaderClient());

    expect(token).toBe('AT');
    expect(sentRefreshToken(fetchMock)).toBe('env-rt');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('still returns the access token when persisting the rotated token fails (criterion 3/4)', async () => {
    getStoredMock.mockResolvedValue('old-rt');
    storeMock.mockRejectedValue(new Error('write fail'));
    fetchMock.mockResolvedValue(mockResponse({ ok: true, body: tokenBody({ refresh_token: 'new-rt' }) }));

    const token = await getAccessToken(new InoreaderClient());

    expect(token).toBe('AT');
    expect(storeMock).toHaveBeenCalledWith('inoreader', 'new-rt');
    expect(logger.error).toHaveBeenCalled();
  });

  it('throws and logs an alert when the refresh request fails (criterion 4)', async () => {
    getStoredMock.mockResolvedValue('stored-rt');
    fetchMock.mockResolvedValue(
      mockResponse({ ok: false, status: 400, statusText: 'Bad Request', body: 'invalid_grant' }),
    );

    await expect(getAccessToken(new InoreaderClient())).rejects.toThrow(/Failed to refresh Inoreader token/);
    expect(logger.error).toHaveBeenCalled();
  });

  it('throws before calling the network when no refresh token is available anywhere', async () => {
    getStoredMock.mockResolvedValue(null);

    await expect(getAccessToken(new InoreaderClient())).rejects.toThrow(/No Inoreader refresh token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
