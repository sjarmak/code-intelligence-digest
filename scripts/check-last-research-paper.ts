/**
 * Check when the last research paper was added to the database
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';

async function main() {
  try {
    const client = await getDbClient();
    const driver = detectDriver();
    const dbUrl = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || 'SQLite (local)';

    console.log(`Using ${driver} database driver`);
    if (driver === 'postgres') {
      // Mask the password in the URL for display
      const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':****@');
      console.log(`Database URL: ${maskedUrl}`);
    } else {
      console.log(`Using local SQLite database`);
    }
    console.log('');

    // Check sync state
    let syncState;
    try {
      const syncResult = await client.query(
        driver === 'postgres'
          ? `SELECT * FROM sync_state WHERE id = $1`
          : `SELECT * FROM sync_state WHERE id = ?`,
        ['daily-sync']
      );
      syncState = syncResult.rows.length > 0 ? syncResult.rows[0] : null;
    } catch (error) {
      console.log('Could not check sync state (table may not exist)');
    }

    if (syncState) {
      const lastUpdated = new Date((syncState.last_updated_at as number) * 1000);
      console.log(`Last daily sync: ${lastUpdated.toISOString()} (${getTimeAgo(lastUpdated)})`);
      console.log(`Sync status: ${syncState.status}`);
      console.log(`Items processed: ${syncState.items_processed || 0}`);
      console.log('');
    }

    // Query for most recent research papers
    let result;
    if (driver === 'postgres') {
      result = await client.query(
        `SELECT id, title, published_at, created_at, category, updated_at
         FROM items
         WHERE category = 'research' AND id LIKE 'ads:%'
         ORDER BY created_at DESC
         LIMIT 5`
      );
    } else {
      // SQLite
      const { getSqlite } = await import('../src/lib/db/index');
      const sqlite = getSqlite();
      const rows = sqlite.prepare(
        `SELECT id, title, published_at, created_at, category, updated_at
         FROM items
         WHERE category = 'research' AND id LIKE 'ads:%'
         ORDER BY created_at DESC
         LIMIT 5`
      ).all();
      result = { rows };
    }

    if (result.rows.length === 0) {
      console.log('No research papers found in the database.');
      return;
    }

    console.log('Most recent research papers:\n');
    result.rows.forEach((row: any, i: number) => {
      const created = new Date((row.created_at as number) * 1000);
      const published = new Date((row.published_at as number) * 1000);
      const updated = row.updated_at ? new Date((row.updated_at as number) * 1000) : null;

      console.log(`${i + 1}. ${(row.title as string)?.substring(0, 70) || 'Untitled'}...`);
      console.log(`   ID: ${row.id}`);
      console.log(`   Created (synced): ${created.toISOString()} (${getTimeAgo(created)})`);
      console.log(`   Published: ${published.toISOString()}`);
      if (updated) {
        console.log(`   Updated: ${updated.toISOString()}`);
      }
      console.log('');
    });

    const mostRecent = result.rows[0] as any;
    const mostRecentCreated = new Date((mostRecent.created_at as number) * 1000);
    console.log(`\nLast research paper added: ${mostRecentCreated.toISOString()} (${getTimeAgo(mostRecentCreated)})`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
}

main();
