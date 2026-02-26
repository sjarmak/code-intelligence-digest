/**
 * Monitor API call costs and efficiency for daily sync
 * 
 * Usage:
 *   npx tsx scripts/monitor-api-costs.ts [--dry-run] [--verbose]
 * 
 * This script:
 * 1. Measures actual API calls during sync
 * 2. Tracks items fetched per call
 * 3. Estimates cost for different scenarios
 * 4. Identifies optimization opportunities
 */

import { getSqlite } from '../src/lib/db/index';
import { getLastPublishedTimestamp } from '../src/lib/db/items';
import { createInoreaderClient } from '../src/lib/inoreader/client';
import { logger } from '../src/lib/logger';
import { Category } from '../src/lib/model';

interface CostMetrics {
  scenario: string;
  itemsSinceLastSync: number;
  estimatedCallsNeeded: number;
  itemsPerCall: number;
  totalEstimatedCost: number;
  notes: string[];
}

const ITEMS_PER_CALL = 1000; // Inoreader returns up to 1000 items per call

/**
 * Calculate estimated API costs for different scenarios
 */
async function analyzeApiCosts(): Promise<void> {
  try {
    logger.info('[MONITOR] Starting API cost analysis...');
    
    // Get database state
    const lastPublished = await getLastPublishedTimestamp();
    const now = Math.floor(Date.now() / 1000);
    
    logger.info(`[MONITOR] Database state:`, {
      lastPublishedTimestamp: lastPublished ? new Date(lastPublished * 1000).toISOString() : 'empty',
      currentTime: new Date(now * 1000).toISOString(),
      hoursSinceLastSync: lastPublished ? Math.round((now - lastPublished) / 3600) : 'N/A',
    });

    // Get user ID to construct stream
    const client = createInoreaderClient();
    const userInfoRaw = await client.getUserInfo();
    const userInfo = userInfoRaw as Record<string, unknown> | undefined;
    const userId = (userInfo?.userId || userInfo?.id) as string;
    
    if (!userId) {
      throw new Error('Could not determine user ID');
    }

    const allItemsStreamId = `user/${userId}/state/com.google/all`;
    
    // Fetch first batch with low limit to estimate sizes
    logger.info('[MONITOR] Fetching sample batch from "all items" stream...');
    
    const sampleResponse = await client.getStreamContents(allItemsStreamId, {
      n: 100, // Small sample to estimate
    });
    
    const unreadCount = sampleResponse.unreadcount ?? 0;
    const totalCount = sampleResponse.totalcount ?? 0;
    
    logger.info(`[MONITOR] Stream counts:`, {
      unreadItems: unreadCount,
      totalItems: totalCount,
      sampleBatchSize: sampleResponse.items?.length || 0,
    });

    // Generate cost scenarios
    const metrics: CostMetrics[] = [];

    // Scenario 1: Current approach (no filtering)
    const callsForAllItems = Math.ceil(totalCount / ITEMS_PER_CALL);
    metrics.push({
      scenario: 'Current (no filtering, fetch ALL items)',
      itemsSinceLastSync: totalCount,
      estimatedCallsNeeded: callsForAllItems,
      itemsPerCall: ITEMS_PER_CALL,
      totalEstimatedCost: callsForAllItems + 1, // +1 for getUserInfo
      notes: [
        `Fetching all ${totalCount} items`,
        `Requires ${callsForAllItems} paginated calls`,
        'This is inefficient and explains 100+ daily calls',
      ],
    });

    // Scenario 2: Optimized (using `ot` parameter)
    let itemsSinceLastSync = 0;
    if (lastPublished) {
      // Estimate items since last sync
      // Rough heuristic: use unread count as proxy for new items
      const unreadRatio = unreadCount / Math.max(totalCount, 1);
      itemsSinceLastSync = Math.ceil(unreadRatio * unreadCount);
    } else {
      // First sync: assume all unread items are new
      itemsSinceLastSync = unreadCount;
    }
    
    const callsForNewItems = Math.ceil(itemsSinceLastSync / ITEMS_PER_CALL);
    metrics.push({
      scenario: 'Optimized (with `ot` parameter)',
      itemsSinceLastSync,
      estimatedCallsNeeded: callsForNewItems,
      itemsPerCall: ITEMS_PER_CALL,
      totalEstimatedCost: callsForNewItems + 1, // +1 for getUserInfo
      notes: [
        `Using 'ot' parameter to filter server-side`,
        `Only ${itemsSinceLastSync} new items since last sync`,
        `Requires ${callsForNewItems} paginated call(s)`,
        `Potential savings: ${Math.max(0, callsForAllItems - callsForNewItems)} calls/day`,
      ],
    });

    // Scenario 3: With feed cache (6h TTL)
    const feedCacheAge = lastPublished ? Math.round((now - lastPublished) / 3600) : 0;
    const feedCacheWillBeValid = feedCacheAge < 6;
    metrics.push({
      scenario: 'With feed cache optimization (6h TTL)',
      itemsSinceLastSync,
      estimatedCallsNeeded: callsForNewItems,
      itemsPerCall: ITEMS_PER_CALL,
      totalEstimatedCost: callsForNewItems + (feedCacheWillBeValid ? 0 : 1), // +0 if cache valid
      notes: [
        `Cache age: ${feedCacheAge} hours`,
        `Cache valid: ${feedCacheWillBeValid ? 'YES' : 'NO'}`,
        `With 6-hour TTL, getSubscriptions() would be called ${feedCacheWillBeValid ? '0 times' : '1 time'} today`,
      ],
    });

    // Display metrics
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║           API COST ESTIMATION & OPTIMIZATION ANALYSIS          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    for (const metric of metrics) {
      console.log(`\n📊 ${metric.scenario}`);
      console.log(`   Items to fetch: ${metric.itemsSinceLastSync.toLocaleString()}`);
      console.log(`   Estimated calls needed: ${metric.estimatedCallsNeeded}`);
      console.log(`   Total cost (with overhead): ${metric.totalEstimatedCost} API calls`);
      
      if (metric.notes.length > 0) {
        console.log('   Notes:');
        for (const note of metric.notes) {
          console.log(`     • ${note}`);
        }
      }
    }

    // Summary and recommendations
    const currentCost = metrics[0].totalEstimatedCost;
    const optimizedCost = metrics[2].totalEstimatedCost;
    const savings = currentCost - optimizedCost;

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                      RECOMMENDATIONS                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    console.log(`✅ Current daily cost: ${currentCost} calls/day`);
    console.log(`✅ Optimized cost: ${optimizedCost} calls/day`);
    console.log(`✅ Potential daily savings: ${savings} calls (${Math.round((savings / currentCost) * 100)}% reduction)`);
    console.log(`✅ Monthly savings: ${savings * 30} calls\n`);

    if (savings > 0) {
      console.log('🎯 Priority fixes (in order):');
      console.log('   1. Use `ot` parameter in daily-sync.ts (DONE)');
      console.log('   2. Stop pagination early when items are older than threshold (DONE)');
      console.log('   3. Extend feed cache TTL to 6+ hours');
      console.log('   4. Disable or auth-protect expensive debug endpoints\n');
    }

    // Item distribution across categories
    console.log('\n📈 Item distribution (if database has items):');
    try {
      const CATEGORIES: Category[] = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];
      for (const category of CATEGORIES) {
        const count = countItemsByCategory(category);
        if (count > 0) {
          console.log(`   ${category}: ${count.toLocaleString()} items`);
        }
      }
    } catch (e) {
      logger.debug('Could not fetch category counts', { error: e instanceof Error ? e.message : String(e) });
    }

  } catch (error) {
    logger.error('[MONITOR] Analysis failed', error);
    process.exit(1);
  }
}

/**
 * Count items in a category
 */
function countItemsByCategory(category: Category): number {
  try {
    const db = getSqlite();
    const row = db
      .prepare(`SELECT COUNT(*) as count FROM items WHERE category = ?`)
      .get(category);
    if (row && typeof row === 'object' && 'count' in row) {
      return (row as { count: number }).count;
    }
    return 0;
  } catch {
    return 0;
  }
}

// Run analysis
analyzeApiCosts().catch((error) => {
  logger.error('Fatal error in monitor', error);
  process.exit(1);
});
