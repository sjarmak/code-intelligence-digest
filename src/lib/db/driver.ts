/**
 * Database driver abstraction for PostgreSQL (required)
 *
 * This module provides a unified interface for PostgreSQL in both development and production:
 * - PostgreSQL is required for both development and production
 * - Local development uses LOCAL_DATABASE_URL (typically via Docker Compose)
 * - Production uses DATABASE_URL (from environment)
 *
 * To use PostgreSQL locally:
 * 1. Start PostgreSQL: npm run db:start
 * 2. Set LOCAL_DATABASE_URL in .env.local (see docker-compose.yml for connection details)
 */

import { logger } from '../logger';
import { ensurePostgresUserIdColumns } from './ensure-user-id';

export type DatabaseDriver = 'postgres';

export interface DbResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DatabaseClient {
  driver: DatabaseDriver;
  query(sql: string, params?: unknown[]): Promise<DbResult>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let clientInstance: DatabaseClient | null = null;
let postgresPool: import('pg').Pool | null = null;

/**
 * Detect which database driver to use based on environment
 *
 * Priority:
 * 1. If USE_LOCAL_DB=true, use LOCAL_DATABASE_URL (for batch scripts)
 * 2. Otherwise, check LOCAL_DATABASE_URL first (for local development)
 * 3. Then check DATABASE_URL (for production)
 */
export function detectDriver(): DatabaseDriver {
  // Check if we should use local database (for batch operations)
  const useLocal = process.env.USE_LOCAL_DB === 'true';

  // Priority: USE_LOCAL_DB flag > LOCAL_DATABASE_URL > DATABASE_URL
  let dbUrl: string | undefined;
  if (useLocal) {
    dbUrl = process.env.LOCAL_DATABASE_URL;
  } else {
    // For normal app usage, prefer LOCAL_DATABASE_URL for local dev, then DATABASE_URL for production
    dbUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
  }

  if (dbUrl?.startsWith('postgres')) {
    return 'postgres';
  }

  throw new Error(
    'PostgreSQL is required: set LOCAL_DATABASE_URL or DATABASE_URL to a postgres:// or postgresql:// connection string (optionally USE_LOCAL_DB=true to force LOCAL_DATABASE_URL).',
  );
}

/**
 * Get the database connection string to use
 * Priority: USE_LOCAL_DB flag > LOCAL_DATABASE_URL > DATABASE_URL
 */
export function getDatabaseUrl(): string | undefined {
  const useLocal = process.env.USE_LOCAL_DB === 'true';
  if (useLocal) {
    return process.env.LOCAL_DATABASE_URL;
  }
  // For normal app usage, prefer LOCAL_DATABASE_URL for local dev, then DATABASE_URL for production
  return process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL;
}

/**
 * Get or create the database client
 */
export async function getDbClient(): Promise<DatabaseClient> {
  if (clientInstance) {
    return clientInstance;
  }

  detectDriver();
  clientInstance = await createPostgresClient();
  await ensurePostgresUserIdColumns(clientInstance);

  logger.info(`Database initialized with postgres driver`);
  return clientInstance;
}

/**
 * Close the shared Postgres pool and drop cached client state.
 * Use sparingly (e.g. debug routes) to avoid reusing a stale singleton in long-lived servers.
 */
export async function resetDbClient(): Promise<void> {
  if (clientInstance) {
    try {
      await clientInstance.close();
    } catch (e) {
      logger.warn('resetDbClient: failed to close pool', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  clientInstance = null;
  postgresPool = null;
}

/**
 * Create PostgreSQL client (production)
 */
async function createPostgresClient(): Promise<DatabaseClient> {
  // Dynamic import pg
  const { Pool } = await import('pg');

  const databaseUrl = getDatabaseUrl() || '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or LOCAL_DATABASE_URL is required for PostgreSQL');
  }
  // Enable SSL for Render databases (required) and production environments
  const needsSSL = process.env.NODE_ENV === 'production' || databaseUrl.includes('render.com');

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: needsSSL ? { rejectUnauthorized: false } : undefined,
    max: 10, // Connection pool size
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 20000, // Return error after 20 seconds if connection cannot be established
    // Note: statement_timeout is a PostgreSQL server setting, not a pool setting
    // It should be set via SET statement_timeout = '60s' per connection if needed
  });

  // Store pool reference for direct access
  postgresPool = pool;

  // Set statement timeout per connection
  pool.on('connect', async (client) => {
    try {
      await client.query("SET statement_timeout = '120s'");
    } catch (err) {
      logger.warn('Failed to set statement_timeout', { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Handle connection errors
  pool.on('error', (err) => {
    logger.error('PostgreSQL pool error', { error: err.message });
    // Reset the pool reference so we can recreate it
    postgresPool = null;
    clientInstance = null;
  });

  // Test connection
  await pool.query('SELECT 1');

  return {
    driver: 'postgres',

    async query(sql: string, params?: unknown[]): Promise<DbResult> {
      const pgSql = normalizeSqlForPostgres(sql);
      const result = await pool.query(pgSql, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      };
    },

    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const pgSql = normalizeSqlForPostgres(sql);
      const result = await pool.query(pgSql, params);
      return { changes: result.rowCount ?? 0 };
    },

    async exec(sql: string): Promise<void> {
      // Split on semicolons only at end of line (avoids splitting inside comments like "-- foo; bar")
      const statements = sql
        .split(/\s*;\s*(?=[\r\n]|$)/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await pool.query(stmt);
      }
    },

    async close(): Promise<void> {
      await pool.end();
      postgresPool = null;
      clientInstance = null;
    },
  };
}

/**
 * Get a fresh connection from the PostgreSQL pool
 * Use this for operations that need a guaranteed fresh connection
 */
export async function getFreshPostgresConnection(): Promise<import('pg').PoolClient> {
  if (!postgresPool) {
    // Ensure pool exists
    await getDbClient();
  }

  if (!postgresPool) {
    throw new Error('PostgreSQL pool not initialized');
  }

  return await postgresPool.connect();
}

/**
 * Normalize SQL for node-postgres.
 *
 * Supports:
 * - SQLite-style `?` placeholders → `$1`, `$2`, ...
 * - Already-native Postgres `$1`, `$2`, ... placeholders (passed through)
 */
function normalizeSqlForPostgres(sql: string): string {
  if (/\$(\d+)/.test(sql)) {
    return sql;
  }
  return convertQuestionMarkPlaceholders(sql);
}

function convertQuestionMarkPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * Get current Unix timestamp expression for the current driver
 */
export function nowTimestamp(driver: DatabaseDriver): string {
  void driver;
  return 'EXTRACT(EPOCH FROM NOW())::INTEGER';
}

/**
 * Get INSERT ... ON CONFLICT syntax for the current driver
 */
export function upsertSyntax(
  driver: DatabaseDriver,
  conflictColumn: string,
  updateColumns: string[]
): string {
  void driver;
  const updates = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
  return `ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates}`;
}
