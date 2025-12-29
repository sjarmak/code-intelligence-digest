#!/usr/bin/env tsx
/**
 * Test connection to local PostgreSQL
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testConnection() {
  const localUrl = process.env.LOCAL_DATABASE_URL;
  console.log('Testing connection to:', localUrl?.replace(/:[^:@]+@/, ':****@'));
  
  if (!localUrl) {
    console.error('❌ LOCAL_DATABASE_URL not set');
    process.exit(1);
  }

  // Parse connection string manually to ensure correct format
  const url = new URL(localUrl);
  const pool = new Pool({
    host: url.hostname,
    port: parseInt(url.port || '5432', 10),
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1), // Remove leading /
    ssl: false,
  });

  try {
    const result = await pool.query('SELECT current_database(), current_user, version()');
    console.log('✅ Connection successful!');
    console.log('Database:', result.rows[0].current_database);
    console.log('User:', result.rows[0].current_user);
    console.log('PostgreSQL version:', result.rows[0].version.split(',')[0]);
    
    // Test if tables exist
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log(`\n📊 Found ${tablesResult.rows.length} tables:`);
    tablesResult.rows.slice(0, 10).forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    if (tablesResult.rows.length > 10) {
      console.log(`  ... and ${tablesResult.rows.length - 10} more`);
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed:', error instanceof Error ? error.message : String(error));
    await pool.end();
    process.exit(1);
  }
}

testConnection();

