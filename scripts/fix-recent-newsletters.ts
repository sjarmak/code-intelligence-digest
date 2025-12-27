/**
 * Manual fix for recent newsletter items
 * Decomposes newsletter items from the last 48 hours and saves the articles
 */

import { initializeDatabase } from '@/src/lib/db/index';
import { loadItemsByCategory } from '@/src/lib/db/items';
import { decomposeFeedItems } from '@/src/lib/pipeline/decompose';
import { categorizeItems } from '@/src/lib/pipeline/categorize';
import { saveItems } from '@/src/lib/db/items';
import { logger } from '@/src/lib/logger';
import { FeedItem } from '@/src/lib/model';

async function fixRecentNewsletters() {
  try {
    logger.info('[FIX-RECENT] Starting manual fix for recent newsletter items');

    // Initialize database
    await initializeDatabase();

    // Load newsletter items from the last 7 days (to catch recent items)
    logger.info('[FIX-RECENT] Loading newsletter items from last 7 days...');
    const newsletterItems = await loadItemsByCategory('newsletters', 7);
    logger.info(`[FIX-RECENT] Found ${newsletterItems.length} newsletter items in 'newsletters' category`);

    // Also check other categories that might contain newsletters
    const allCategories = ['newsletters', 'ai_news', 'product_news', 'tech_articles'];
    const allItems: FeedItem[] = [...newsletterItems];

    for (const category of allCategories) {
      const items = await loadItemsByCategory(category, 7);
      // Filter to items that look like newsletters (from known newsletter sources)
      const newsletterLikeItems = items.filter(item =>
        item.sourceTitle.includes('TLDR') ||
        item.sourceTitle.includes('Byte Byte Go') ||
        item.sourceTitle.includes('Pointer') ||
        item.sourceTitle.includes('Elevate') ||
        item.sourceTitle.includes('Architecture Notes') ||
        item.sourceTitle.includes('Leadership in Tech') ||
        item.sourceTitle.includes('Programming Digest') ||
        item.sourceTitle.includes('System Design') ||
        item.sourceTitle.includes('Pragmatic Engineer') ||
        item.url.includes('substack.com') ||
        item.url.includes('tldr.tech')
      );
      // Only add if not already in allItems (avoid duplicates)
      newsletterLikeItems.forEach(item => {
        if (!allItems.find(existing => existing.id === item.id)) {
          allItems.push(item);
        }
      });
      logger.info(`[FIX-RECENT] Found ${newsletterLikeItems.length} newsletter-like items in ${category} category`);
    }

    // Combine and deduplicate by ID
    const itemMap = new Map<string, FeedItem>();
    [...newsletterItems, ...allItems].forEach(item => {
      if (!itemMap.has(item.id)) {
        itemMap.set(item.id, item);
      }
    });

    const itemsToProcess = Array.from(itemMap.values());
    logger.info(`[FIX-RECENT] Processing ${itemsToProcess.length} unique newsletter items`);

    if (itemsToProcess.length === 0) {
      logger.info('[FIX-RECENT] No newsletter items to process');
      return;
    }

    // Log sample items
    logger.info(`[FIX-RECENT] Sample items to process:`);
    itemsToProcess.slice(0, 5).forEach(item => {
      logger.info(`  - ${item.title.substring(0, 60)}... (${item.category}, ${item.sourceTitle})`);
    });

    // Decompose newsletter items
    logger.info('[FIX-RECENT] Decomposing newsletter items...');
    let decomposed = decomposeFeedItems(itemsToProcess);
    logger.info(`[FIX-RECENT] After decomposition: ${decomposed.length} items (${decomposed.length - itemsToProcess.length} new articles)`);

    // Categorize the decomposed items
    decomposed = categorizeItems(decomposed);

    // Group by category for logging
    const byCategory = new Map<string, FeedItem[]>();
    decomposed.forEach(item => {
      if (!byCategory.has(item.category)) {
        byCategory.set(item.category, []);
      }
      byCategory.get(item.category)!.push(item);
    });

    logger.info('[FIX-RECENT] Decomposed items by category:');
    for (const [category, items] of byCategory.entries()) {
      logger.info(`  ${category}: ${items.length} items`);
    }

    // Save all decomposed items
    if (decomposed.length > 0) {
      logger.info(`[FIX-RECENT] Saving ${decomposed.length} decomposed items to database...`);
      await saveItems(decomposed);
      logger.info(`[FIX-RECENT] Successfully saved ${decomposed.length} items`);
    } else {
      logger.warn('[FIX-RECENT] No items to save after decomposition');
    }

    logger.info('[FIX-RECENT] Manual fix completed successfully');
    console.log('\n✓ Fix completed!');
    console.log(`  Original items: ${itemsToProcess.length}`);
    console.log(`  Decomposed items: ${decomposed.length}`);
    console.log(`  New articles extracted: ${decomposed.length - itemsToProcess.length}`);
    console.log(`  Categories: ${Array.from(byCategory.keys()).join(', ')}`);

  } catch (error) {
    logger.error('[FIX-RECENT] Fix failed', error);
    console.error('\n✗ Fix failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

fixRecentNewsletters();

