/**
 * Unit tests for the oauth_tokens persistence layer (bd-mp5).
 *
 * These cover the read-through cache primitives that back Inoreader
 * refresh-token rotation. The DB driver is mocked so the tests are
 * deterministic and do not require a live Postgres connection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { queryMock, runMock, detectDriverMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  runMock: vi.fn(),
  detectDriverMock: vi.fn(),
}));

vi.mock('@/src/lib/db/driver', () => ({
  getDbClient: vi.fn(async () => ({
    driver: 'postgres',
    query: queryMock,
    run: runMock,
  })),
  detectDriver: detectDriverMock,
}));

import {
  getStoredRefreshToken,
  storeRefreshToken,
  seedRefreshTokenIfMissing,
} from '@/src/lib/db/oauth-tokens';

describe('oauth_tokens persistence (bd-mp5)', () => {
  beforeEach(() => {
    queryMock.mockReset();
    runMock.mockReset().mockResolvedValue({ changes: 1 });
    detectDriverMock.mockReset().mockReturnValue('postgres');
  });

  describe('getStoredRefreshToken', () => {
    it('returns the stored refresh token for a provider', async () => {
      queryMock.mockResolvedValue({ rows: [{ refresh_token: 'rt-123' }], rowCount: 1 });

      const token = await getStoredRefreshToken('inoreader');

      expect(token).toBe('rt-123');
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('SELECT refresh_token FROM oauth_tokens'),
        ['inoreader'],
      );
    });

    it('returns null when no row exists for the provider', async () => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

      expect(await getStoredRefreshToken('inoreader')).toBeNull();
    });

    it('returns null when the row is present but has no refresh_token', async () => {
      queryMock.mockResolvedValue({ rows: [{}], rowCount: 1 });

      expect(await getStoredRefreshToken('inoreader')).toBeNull();
    });
  });

  describe('storeRefreshToken', () => {
    it('upserts the rotated token via ON CONFLICT DO UPDATE (postgres)', async () => {
      await storeRefreshToken('inoreader', 'new-rt');

      expect(runMock).toHaveBeenCalledTimes(1);
      const [sql, params] = runMock.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO oauth_tokens/);
      expect(sql).toMatch(/ON CONFLICT \(provider\) DO UPDATE/);
      expect(sql).toMatch(/refresh_token = EXCLUDED\.refresh_token/);
      expect(params).toEqual(['inoreader', 'new-rt']);
    });
  });

  describe('seedRefreshTokenIfMissing', () => {
    it('inserts only when missing via ON CONFLICT DO NOTHING (postgres)', async () => {
      await seedRefreshTokenIfMissing('inoreader', 'env-rt');

      expect(runMock).toHaveBeenCalledTimes(1);
      const [sql, params] = runMock.mock.calls[0];
      expect(sql).toMatch(/INSERT INTO oauth_tokens/);
      expect(sql).toMatch(/ON CONFLICT \(provider\) DO NOTHING/);
      expect(params).toEqual(['inoreader', 'env-rt']);
    });

    it('does not overwrite an existing row (DO NOTHING, not DO UPDATE)', async () => {
      await seedRefreshTokenIfMissing('inoreader', 'env-rt');

      const [sql] = runMock.mock.calls[0];
      expect(sql).not.toMatch(/DO UPDATE/);
    });
  });
});
