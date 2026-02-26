#!/usr/bin/env npx tsx

import { getDbClient, detectDriver } from '../src/lib/db/driver';

async function main() {
  const driver = detectDriver();
  const client = await getDbClient();

  const itemIds = [
    'ads:2025arXiv250924091G',
    'ads:2026arXiv260109393W',
    'ads:2025arXiv251204111L',
    'ads:2026arXiv260110343D',
    'ads:2025arXiv251113998Q',
  ];

  console.log(`Using driver: ${driver}\n`);

  if (driver === 'postgres') {
    for (const itemId of itemIds) {
      const result = await client.query(
        'SELECT id, title, LENGTH(full_text) as full_text_len, full_text_source, full_text IS NULL as is_null FROM items WHERE id = $1',
        [itemId]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        console.log(`${itemId}:`);
        console.log(`  Title: ${row.title}`);
        console.log(`  Full text length: ${row.full_text_len}`);
        console.log(`  Full text source: ${row.full_text_source}`);
        console.log(`  Is NULL: ${row.is_null}`);
        console.log('');
      } else {
        console.log(`${itemId}: NOT FOUND in items table\n`);
      }
    }
  } else {
    const { getSqlite } = await import('../src/lib/db/index');
    const sqlite = getSqlite();
    for (const itemId of itemIds) {
      const row = sqlite
        .prepare('SELECT id, title, LENGTH(full_text) as full_text_len, full_text_source, full_text IS NULL as is_null FROM items WHERE id = ?')
        .get(itemId) as any;
      if (row) {
        console.log(`${itemId}:`);
        console.log(`  Title: ${row.title}`);
        console.log(`  Full text length: ${row.full_text_len}`);
        console.log(`  Full text source: ${row.full_text_source}`);
        console.log(`  Is NULL: ${row.is_null}`);
        console.log('');
      } else {
        console.log(`${itemId}: NOT FOUND in items table\n`);
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
