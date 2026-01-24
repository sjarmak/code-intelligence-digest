#!/usr/bin/env npx tsx

import { getDbClient, detectDriver } from '../src/lib/db/driver';

async function main() {
  const driver = detectDriver();
  const client = await getDbClient();

  if (driver === 'postgres') {
    const result = await client.query(
      'SELECT id, title, LENGTH(full_text) as full_text_len, full_text_source FROM items WHERE id LIKE $1 LIMIT 10',
      ['ads:%']
    );
    console.log('Research items with full_text:');
    console.log(JSON.stringify(result.rows, null, 2));

    // Also check ads_papers table
    const adsResult = await client.query(
      'SELECT bibcode, title, LENGTH(body) as body_len FROM ads_papers WHERE bibcode IN (SELECT SUBSTRING(id, 5) FROM items WHERE id LIKE $1 LIMIT 10)',
      ['ads:%']
    );
    console.log('\nCorresponding ads_papers entries:');
    console.log(JSON.stringify(adsResult.rows, null, 2));
  } else {
    const { getSqlite } = await import('../src/lib/db/index');
    const sqlite = getSqlite();
    const rows = sqlite
      .prepare('SELECT id, title, LENGTH(full_text) as full_text_len, full_text_source FROM items WHERE id LIKE ? LIMIT 10')
      .all('ads:%');
    console.log('Research items with full_text:');
    console.log(JSON.stringify(rows, null, 2));
  }

  process.exit(0);
}

main().catch(console.error);
