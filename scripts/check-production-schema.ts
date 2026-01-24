#!/usr/bin/env tsx
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // List all tables
  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  console.log('\n📋 Tables in production database:');
  tables.rows.forEach(row => console.log(`  - ${row.table_name}`));

  // Check if pgvector extension is installed
  const extensions = await pool.query(`
    SELECT extname, extversion
    FROM pg_extension
  `);

  console.log('\n🔌 Installed extensions:');
  extensions.rows.forEach(row => console.log(`  - ${row.extname} (${row.extversion})`));

  await pool.end();
}

main().catch(console.error);
