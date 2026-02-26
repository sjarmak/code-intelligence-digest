#!/usr/bin/env tsx
/**
 * Test local PostgreSQL connection and driver detection
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { detectDriver, getDbClient, getDatabaseUrl } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function testConnection() {
  console.log('Testing local PostgreSQL connection...\n');

  // Check environment variables
  console.log('Environment variables:');
  console.log(`  LOCAL_DATABASE_URL: ${process.env.LOCAL_DATABASE_URL ? '✅ Set' : '❌ Not set'}`);
  console.log(`  DATABASE_URL: ${process.env.DATABASE_URL ? '✅ Set' : '❌ Not set'}`);
  console.log(`  USE_LOCAL_DB: ${process.env.USE_LOCAL_DB || 'not set'}`);
  console.log('');

  // Check driver detection
  const driver = detectDriver();
  const dbUrl = getDatabaseUrl();
  console.log(`Detected driver: ${driver}`);
  console.log(`Database URL: ${dbUrl ? dbUrl.replace(/:[^:@]+@/, ':****@') : 'none'}`);
  console.log('');

  if (driver === 'postgres') {
    try {
      const client = await getDbClient();
      console.log('✅ Successfully connected to PostgreSQL');

      // Test query
      const result = await client.query('SELECT version()');
      const version = (result.rows[0] as any)?.version || 'unknown';
      console.log(`PostgreSQL version: ${version.split(',')[0]}`);

      // Check if schema is initialized
      const tablesResult = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);
      const tables = tablesResult.rows.map((r: any) => r.table_name);
      console.log(`\nFound ${tables.length} tables in database:`);
      tables.slice(0, 10).forEach((table: string) => {
        console.log(`  - ${table}`);
      });
      if (tables.length > 10) {
        console.log(`  ... and ${tables.length - 10} more`);
      }

      await client.close();
      console.log('\n✅ Connection test passed!');
    } catch (error) {
      console.error('❌ Connection test failed:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  } else {
    console.log('⚠️  Using SQLite instead of PostgreSQL');
    console.log('To use PostgreSQL, set LOCAL_DATABASE_URL in .env.local');
    console.log('Example: LOCAL_DATABASE_URL=postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel');
  }
}

testConnection()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Test failed', { error });
    process.exit(1);
  });
