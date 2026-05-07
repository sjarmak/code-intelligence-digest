import { getDbClient, detectDriver } from './driver';

export type OAuthProvider = 'inoreader';

export async function getStoredRefreshToken(provider: OAuthProvider): Promise<string | null> {
  const client = await getDbClient();
  const result = await client.query(
    'SELECT refresh_token FROM oauth_tokens WHERE provider = ?',
    [provider],
  );
  const row = result.rows[0] as { refresh_token?: string } | undefined;
  return row?.refresh_token ?? null;
}

export async function storeRefreshToken(provider: OAuthProvider, refreshToken: string): Promise<void> {
  const client = await getDbClient();
  const driver = detectDriver();
  const sql = driver === 'postgres'
    ? `INSERT INTO oauth_tokens (provider, refresh_token, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (provider) DO UPDATE
       SET refresh_token = EXCLUDED.refresh_token, updated_at = NOW()`
    : `INSERT INTO oauth_tokens (provider, refresh_token, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (provider) DO UPDATE
       SET refresh_token = excluded.refresh_token, updated_at = CURRENT_TIMESTAMP`;
  await client.run(sql, [provider, refreshToken]);
}

export async function seedRefreshTokenIfMissing(provider: OAuthProvider, envToken: string): Promise<void> {
  const client = await getDbClient();
  const driver = detectDriver();
  const sql = driver === 'postgres'
    ? `INSERT INTO oauth_tokens (provider, refresh_token) VALUES ($1, $2)
       ON CONFLICT (provider) DO NOTHING`
    : `INSERT OR IGNORE INTO oauth_tokens (provider, refresh_token) VALUES (?, ?)`;
  await client.run(sql, [provider, envToken]);
}
