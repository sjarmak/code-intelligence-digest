import { getDbClient } from '../src/lib/db/driver';

async function main() {
  const client = await getDbClient();
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 24*60*60;
  const twoDaysAgo = now - 48*60*60;
  
  console.log('=== Newsletter Date Analysis ===');
  console.log('Now:', new Date(now * 1000).toISOString());
  console.log('1 day ago cutoff:', new Date(oneDayAgo * 1000).toISOString());
  
  const last24h = await client.query(
    'SELECT COUNT(*) as cnt FROM items WHERE category = $1 AND created_at >= $2',
    ['newsletters', oneDayAgo]
  );
  console.log('\nNewsletters synced in last 24h (created_at):', last24h.rows[0].cnt);
  
  const last48h = await client.query(
    'SELECT COUNT(*) as cnt FROM items WHERE category = $1 AND created_at >= $2',
    ['newsletters', twoDaysAgo]
  );
  console.log('Newsletters synced in last 48h (created_at):', last48h.rows[0].cnt);
  
  const recent = await client.query(
    'SELECT title, created_at, published_at FROM items WHERE category = $1 ORDER BY created_at DESC LIMIT 5',
    ['newsletters']
  );
  console.log('\nMost recently synced newsletters (by created_at):');
  for (const r of recent.rows) {
    const synced = new Date(Number(r.created_at) * 1000);
    const published = new Date(Number(r.published_at) * 1000);
    const hoursAgoSynced = (now - Number(r.created_at)) / 3600;
    console.log(`  - synced: ${synced.toISOString()} (${hoursAgoSynced.toFixed(1)}h ago)`);
    console.log(`    published: ${published.toISOString()}`);
    console.log(`    ${r.title?.slice(0, 60)}`);
  }
  
  // Check what daily would return
  const dailyItems = await client.query(
    'SELECT title, created_at, published_at FROM items WHERE category = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 5',
    ['newsletters', oneDayAgo]
  );
  console.log(`\n=== Daily View (created_at >= 24h ago) ===`);
  console.log(`Would return ${dailyItems.rows.length} items`);
  for (const r of dailyItems.rows) {
    const synced = new Date(Number(r.created_at) * 1000);
    const published = new Date(Number(r.published_at) * 1000);
    console.log(`  - synced: ${synced.toISOString()}, published: ${published.toISOString()}`);
    console.log(`    ${r.title?.slice(0, 60)}`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
