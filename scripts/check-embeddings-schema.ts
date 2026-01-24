#!/usr/bin/env tsx
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  // Get schema for item_embeddings
  const schema = await pool.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'item_embeddings'
    ORDER BY ordinal_position
  `);

  console.log('\n📊 item_embeddings table schema:');
  schema.rows.forEach(row => {
    console.log(`  - ${row.column_name}: ${row.data_type} (${row.udt_name})`);
  });

  // Count embeddings
  const count = await pool.query(`SELECT COUNT(*) FROM item_embeddings`);
  console.log(`\n📈 Total embeddings in production: ${count.rows[0].count}`);

  // Sample a few
  const sample = await pool.query(`
    SELECT item_id, array_length(embedding, 1) as dimension
    FROM item_embeddings
    LIMIT 5
  `);

  console.log('\n🔍 Sample embeddings:');
  sample.rows.forEach(row => {
    console.log(`  - ${row.item_id}: ${row.dimension} dimensions`);
  });

  await pool.end();
}

main().catch(console.error);
