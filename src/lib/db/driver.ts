/**
 * Database driver abstraction for PostgreSQL (required)
 *
 * This module provides a unified interface for PostgreSQL in both development and production:
 * - PostgreSQL is required for both development and production
 * - Local development uses LOCAL_DATABASE_URL (typically via Docker Compose)
 * - Production uses DATABASE_URL (from environment)
 * - Falls back to SQLite only if no PostgreSQL connection string is provided (legacy, not recommended)
 *
 * To use PostgreSQL locally:
 * 1. Start PostgreSQL: npm run db:start
 * 2. Set LOCAL_DATABASE_URL in .env.local (see docker-compose.yml for connection details)
 */

import { logger } from '../logger';
import { ensurePostgresUserIdColumns } from './ensure-user-id';

export type DatabaseDriver = 'sqlite' | 'postgres';

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
 * 4. Fall back to SQLite only if no PostgreSQL connection string is found
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

  // PostgreSQL connection string takes precedence
  if (dbUrl?.startsWith('postgres')) {
    return 'postgres';
  }

  // Fall back to SQLite only if no PostgreSQL URL is configured (legacy, not recommended)
  // PostgreSQL is required for both development and production
  return 'sqlite';
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

  const driver = detectDriver();

  if (driver === 'postgres') {
    clientInstance = await createPostgresClient();
    await ensurePostgresUserIdColumns(clientInstance);
  } else {
    clientInstance = await createSqliteClient();
  }

  logger.info(`Database initialized with ${driver} driver`);
  return clientInstance;
}

/**
 * Create SQLite client (development)
 */
async function createSqliteClient(): Promise<DatabaseClient> {
  // Dynamic import to avoid bundling in production
  const Database = (await import('better-sqlite3')).default;
  const path = await import('path');
  const fs = await import('fs');

  const dataDir = path.join(process.cwd(), '.data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'digest.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');

  return {
    driver: 'sqlite',

    async query(sql: string, params?: unknown[]): Promise<DbResult> {
      const stmt = sqlite.prepare(sql);
      const rows = params ? stmt.all(...params) : stmt.all();
      return {
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
      };
    },

    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(sql);
      const result = params ? stmt.run(...params) : stmt.run();
      return { changes: result.changes };
    },

    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    },

    async close(): Promise<void> {
      sqlite.close();
      clientInstance = null;
    },
  };
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
      // Convert SQLite-style ? placeholders to Postgres $1, $2, etc
      const pgSql = convertPlaceholders(sql);
      const result = await pool.query(pgSql, params);
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? 0,
      };
    },

    async run(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const pgSql = convertPlaceholders(sql);
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
 * Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
 */
function convertPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * Get current Unix timestamp expression for the current driver
 */
export function nowTimestamp(driver: DatabaseDriver): string {
  if (driver === 'postgres') {
    return 'EXTRACT(EPOCH FROM NOW())::INTEGER';
  }
  return "strftime('%s', 'now')";
}

/**
 * Get INSERT ... ON CONFLICT syntax for the current driver
 */
export function upsertSyntax(
  driver: DatabaseDriver,
  conflictColumn: string,
  updateColumns: string[]
): string {
  if (driver === 'postgres') {
    const updates = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ');
    return `ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates}`;
  }
  // SQLite uses INSERT OR REPLACE which replaces the entire row
  // For column-specific updates, use INSERT ... ON CONFLICT ... DO UPDATE
  const updates = updateColumns.map(col => `${col} = excluded.${col}`).join(', ');
  return `ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates}`;
}
