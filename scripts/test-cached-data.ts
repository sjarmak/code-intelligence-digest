/**
 * Test the cached data without API calls
 * Uses the 100 items already in the database
 */

import { initializeDatabase, getSqlite } from '../src/lib/db/index';
import { loadItemsByCategory } from '../src/lib/db/items';
import { logger } from '../src/lib/logger';

async function main() {
  console.log('\n=== Testing Cached Data ===\n');

  // Initialize database
  await initializeDatabase();
  const sqlite = getSqlite();

  // 1. Basic counts
  console.log('📊 Data Summary');
  console.log('==================');

  const totalCount = sqlite
    .prepare('SELECT COUNT(*) as count FROM items')
    .get() as { count: number };
  console.log(`Total items: ${totalCount.count}`);

  const byCategory = sqlite
    .prepare('SELECT category, COUNT(*) as count FROM items GROUP BY category ORDER BY count DESC')
    .all() as Array<{ category: string; count: number }>;

  console.log('\nBy Category:');
  for (const cat of byCategory) {
    console.log(`  ${cat.category}: ${cat.count}`);
  }

  // 2. Date range
  console.log('\n\n📅 Date Range');
  console.log('==================');

  const dateStats = sqlite
    .prepare(`
      SELECT 
        MIN(published_at) as oldest_timestamp,
        MAX(published_at) as newest_timestamp,
        COUNT(*) as count
      FROM items
    `)
    .get() as { oldest_timestamp: number; newest_timestamp: number; count: number };

  const oldest = new Date(dateStats.oldest_timestamp * 1000);
  const newest = new Date(dateStats.newest_timestamp * 1000);
  const ageInDays = (Date.now() - dateStats.oldest_timestamp * 1000) / (24 * 60 * 60 * 1000);

  console.log(`Oldest: ${oldest.toISOString()}`);
  console.log(`Newest: ${newest.toISOString()}`);
  console.log(`Span: ${ageInDays.toFixed(1)} days`);

  // 3. Top sources
  console.log('\n\n📰 Top Sources');
  console.log('==================');

  const topSources = sqlite
    .prepare(`
      SELECT source_title, COUNT(*) as count 
      FROM items 
      GROUP BY source_title 
      ORDER BY count DESC 
      LIMIT 10
    `)
    .all() as Array<{ source_title: string; count: number }>;

  for (const source of topSources) {
    console.log(`  ${source.source_title}: ${source.count}`);
  }

  // 4. Sample items
  console.log('\n\n📌 Sample Items');
  console.log('==================');

  const samples = sqlite
    .prepare(`
      SELECT 
        id,
        category,
        title,
        source_title,
        published_at,
        url
      FROM items 
      ORDER BY published_at DESC 
      LIMIT 5
    `)
    .all() as Array<{
    id: string;
    category: string;
    title: string;
    source_title: string;
    published_at: number;
    url: string;
  }>;

  for (const item of samples) {
    console.log(`\n  [${item.category}] ${item.source_title}`);
    console.log(`  ${item.title}`);
    console.log(`  ${new Date(item.published_at * 1000).toISOString()}`);
    console.log(`  ${item.url}`);
  }

  // 5. Test category loading
  console.log('\n\n🎯 Category Loading Test');
  console.log('==================');

  for (const category of ['newsletters', 'tech_articles', 'product_news', 'community', 'research']) {
    const items = await loadItemsByCategory(category, 30);
    console.log(`${category}: ${items.length} items`);
  }

  // 6. Test data quality
  console.log('\n\n✅ Data Quality Checks');
  console.log('==================');

  const missingData = sqlite
    .prepare(`
      SELECT 
        SUM(CASE WHEN title IS NULL OR title = '' THEN 1 ELSE 0 END) as missing_title,
        SUM(CASE WHEN url IS NULL OR url = '' THEN 1 ELSE 0 END) as missing_url,
        SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) as missing_date,
        SUM(CASE WHEN summary IS NULL OR summary = '' THEN 1 ELSE 0 END) as missing_summary,
        COUNT(*) as total
      FROM items
    `)
    .get() as {
    missing_title: number;
    missing_url: number;
    missing_date: number;
    missing_summary: number;
    total: number;
  };

  console.log(`Missing titles: ${missingData.missing_title}/${missingData.total}`);
  console.log(`Missing URLs: ${missingData.missing_url}/${missingData.total}`);
  console.log(`Missing dates: ${missingData.missing_date}/${missingData.total}`);
  console.log(`Missing summaries: ${missingData.missing_summary}/${missingData.total}`);

  const summaryLengths = sqlite
    .prepare(`
      SELECT 
        AVG(LENGTH(summary)) as avg_length,
        MIN(LENGTH(summary)) as min_length,
        MAX(LENGTH(summary)) as max_length
      FROM items
      WHERE summary IS NOT NULL AND summary != ''
    `)
    .get() as {
    avg_length: number;
    min_length: number;
    max_length: number;
  };

  console.log(`\nSummary lengths:`);
  console.log(`  Avg: ${summaryLengths.avg_length?.toFixed(0) ?? 0} chars`);
  console.log(`  Min: ${summaryLengths.min_length ?? 0} chars`);
  console.log(`  Max: ${summaryLengths.max_length ?? 0} chars`);

  // 7. Author stats
  console.log('\n\n👤 Author Coverage');
  console.log('==================');

  const authorStats = sqlite
    .prepare(`
      SELECT 
        SUM(CASE WHEN author IS NULL OR author = '' THEN 1 ELSE 0 END) as missing_author,
        COUNT(*) as total
      FROM items
    `)
    .get() as { missing_author: number; total: number };

  console.log(`Items with authors: ${authorStats.total - authorStats.missing_author}/${authorStats.total}`);

  // 8. Readiness summary
  console.log('\n\n🚀 System Readiness');
  console.log('==================');

  const readinessChecks = [
    { name: 'Database initialized', status: totalCount.count > 0 },
    { name: 'Items cached', status: totalCount.count >= 100 },
    { name: 'Categories populated', status: byCategory.length > 0 },
    { name: 'Date range spans 7+ days', status: ageInDays >= 7 },
    { name: 'Sources diverse (3+)', status: topSources.length >= 3 },
    { name: 'Data quality >95%', status: missingData.missing_title === 0 && missingData.missing_url === 0 },
    { name: 'Ready for ranking tests', status: totalCount.count >= 50 },
  ];

  for (const check of readinessChecks) {
    console.log(`${check.status ? '✅' : '⚠️ '} ${check.name}`);
  }

  console.log('\n✅ Cache test complete!\n');
}

main().catch((error) => {
  logger.error('Test failed', error);
  process.exit(1);
});
