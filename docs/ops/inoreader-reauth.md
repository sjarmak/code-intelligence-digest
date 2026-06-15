# Inoreader re-auth recovery

Failure mode covered: Inoreader sync stops with `invalid_grant` on token refresh, because the stored refresh token is no longer accepted (the chain was broken — e.g. the app deployed an old `INOREADER_REFRESH_TOKEN`, the token was revoked in the Inoreader account, or a rotated token failed to persist).

## How token storage works

Inoreader rotates the refresh token on every `/oauth2/token` call. The client reads the token through a DB-backed read-through cache (`src/lib/inoreader/client.ts:101-115`):

1. Read the refresh token from the `oauth_tokens` row (`getStoredRefreshToken`).
2. If the row is missing, seed it from `INOREADER_REFRESH_TOKEN` (`seedRefreshTokenIfMissing`, insert-only) and use the env value.
3. On a successful refresh, write the rotated token back to the row (`storeRefreshToken`, upsert) — `src/lib/inoreader/client.ts:151-161`.

**The DB row is the source of truth once it exists.** Seeding is insert-only (`ON CONFLICT DO NOTHING`), so updating only the `INOREADER_REFRESH_TOKEN` env var does **not** fix a bad stored token — the app keeps reading the stale row. Recovery must replace or clear the row.

## Detecting the failure

The refresh failure is logged (it is not silent until the next sync):

```
[INOREADER-AUTH] Refresh failed — manual re-auth may be required   (status, statusText, body)
```

A persist failure after a successful refresh logs at error level too:

```
[INOREADER-AUTH] CRITICAL: failed to persist rotated refresh token — next refresh will fail
```

## Recovery

1. **Mint a fresh refresh token** via the OAuth flow:

   ```bash
   npm run auth-inoreader
   ```

   This prints a new `INOREADER_REFRESH_TOKEN`. (Requires `INOREADER_CLIENT_ID` and `INOREADER_CLIENT_SECRET` in `.env.local` or entered at the prompt.)

2. **Update the env var** wherever it is configured:
   - Local: set `INOREADER_REFRESH_TOKEN` in `.env.local`.
   - Production (Render): update the `INOREADER_REFRESH_TOKEN` environment variable and redeploy.

3. **Clear the stale DB row** so the fresh env token re-seeds. Because seeding is insert-only, the existing row must be removed (or directly updated):

   ```sql
   DELETE FROM oauth_tokens WHERE provider = 'inoreader';
   ```

   - Local dev: run it against `LOCAL_DATABASE_URL` (e.g. via the Postgres container started by `npm run db:start`).
   - Production: run it against `DATABASE_URL` from the Render Postgres console. (Do not run `psql "$DATABASE_URL"` from an agent session — it hangs in this environment.)

   Alternatively, `UPDATE oauth_tokens SET refresh_token = '<new-token>', updated_at = NOW() WHERE provider = 'inoreader';` updates the row in place without re-seeding.

4. **Verify** by triggering a sync and confirming the log shows a successful refresh (and, on the next rotation, `Persisted rotated refresh token`).

After step 3 the next `getAccessToken()` seeds from the updated env var and resumes writing rotated tokens back to the row automatically.
