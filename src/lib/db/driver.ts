/**
 * Database driver abstraction for SQLite (dev) and PostgreSQL (prod)
 *
 * This module provides a unified interface that:
 * - Uses better-sqlite3 in development (no DATABASE_URL)
 * - Uses pg in production (DATABASE_URL set)
 *
 * MIGRATION STATUS: This is a transitional file.
 * Once PostgreSQL support is fully implemented, the SQLite code path
 * can be removed for production builds.
 */

import { logger } from '../logger';

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

/**
 * Detect which database driver to use based on environment
 * 
 * For the app: Always uses DATABASE_URL (production)
 * For batch scripts: Can use LOCAL_DATABASE_URL by setting USE_LOCAL_DB=true
 */
export function detectDriver(): DatabaseDriver {
  // Check if we should use local database (for batch operations)
  const useLocal = process.env.USE_LOCAL_DB === 'true';
  const dbUrl = useLocal ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL;
  
  // PostgreSQL connection string takes precedence
  if (dbUrl?.startsWith('postgres')) {
    return 'postgres';
  }
  return 'sqlite';
}

/**
 * Get the database connection string to use
 * For app: Uses DATABASE_URL
 * For batch scripts: Uses LOCAL_DATABASE_URL if USE_LOCAL_DB=true
 */
export function getDatabaseUrl(): string | undefined {
  const useLocal = process.env.USE_LOCAL_DB === 'true';
  return useLocal ? process.env.LOCAL_DATABASE_URL : process.env.DATABASE_URL;
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
    connectionTimeoutMillis: 10000, // Return error after 10 seconds if connection cannot be established
    statement_timeout: 60000, // 60 second statement timeout (PostgreSQL setting)
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
      // Split multiple statements and execute
      const statements = sql.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          await pool.query(stmt);
        }
      }
    },

    async close(): Promise<void> {
      await pool.end();
      clientInstance = null;
    },
  };
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
