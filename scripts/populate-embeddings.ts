#!/usr/bin/env tsx
/**
 * Batch job to generate embeddings for all items in the database
 * 
 * Usage:
 *   npx tsx scripts/populate-embeddings.ts [options]
 * 
 * Options:
 *   --category <category>  Only process items in this category
 *   --limit <number>       Limit number of items to process (default: all)
 *   --skip-existing        Skip items that already have embeddings
 */

import { initializeDatabase } from '../src/lib/db/index';
import { loadAllItems, loadItemsByCategory } from '../src/lib/db/items';
import { getEmbeddingsBatch } from '../src/lib/db/embeddings';
import { generateEmbeddingsBatch } from '../src/lib/embeddings/generate';
import { saveEmbeddingsBatch } from '../src/lib/db/embeddings';
import { logger } from '../src/lib/logger';
import type { Category, FeedItem } from '../src/lib/model';

interface Stats {
  total: number;
  skipped: number;
  generated: number;
  failed: number;
  duration: number;
}

async function populateEmbeddings(
  items: FeedItem[],
  skipExisting: boolean = true
): Promise<Stats> {
  const startTime = Date.now();
  const stats: Stats = {
    total: items.length,
    skipped: 0,
    generated: 0,
    failed: 0,
    duration: 0,
  };

  if (items.length === 0) {
    logger.info('No items to process');
    return stats;
  }

  logger.info(`Starting embedding generation for ${items.length} items`);

  // Check which items already have embeddings if skipping
  let itemsToProcess = items;
  if (skipExisting) {
    const itemIds = items.map(item => item.id);
    const existingEmbeddings = await getEmbeddingsBatch(itemIds);
    itemsToProcess = items.filter(item => !existingEmbeddings.has(item.id));
    stats.skipped = items.length - itemsToProcess.length;
    
    logger.info(`Skipping ${stats.skipped} items that already have embeddings`);
    logger.info(`Processing ${itemsToProcess.length} items that need embeddings`);
  }

  if (itemsToProcess.length === 0) {
    logger.info('All items already have embeddings');
    stats.duration = Date.now() - startTime;
    return stats;
  }

  // Prepare items for batch embedding generation
  // Include fullText if available for better semantic quality
  const itemsForEmbedding = itemsToProcess.map(item => {
    const fullText = item.fullText ? item.fullText.substring(0, 2000) : '';
    const text = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''} ${fullText}`.trim();
    return {
      id: item.id,
      text: text || item.title, // Fallback to title if text is empty
    };
  });

  logger.info(`Generating embeddings in batches...`);
  const embeddings = await generateEmbeddingsBatch(itemsForEmbedding);

  // Convert to format for saving
  const embeddingsToSave = Array.from(embeddings.entries())
    .map(([itemId, embedding]) => ({
      itemId,
      embedding,
    }))
    .filter(item => item.embedding.length > 0); // Filter out zero vectors

  stats.generated = embeddingsToSave.length;
  stats.failed = itemsToProcess.length - embeddingsToSave.length;

  // Save embeddings to database
  if (embeddingsToSave.length > 0) {
    logger.info(`Saving ${embeddingsToSave.length} embeddings to database...`);
    await saveEmbeddingsBatch(embeddingsToSave);
    logger.info(`✅ Saved ${embeddingsToSave.length} embeddings`);
  }

  if (stats.failed > 0) {
    logger.warn(`⚠️  Failed to generate ${stats.failed} embeddings`);
  }

  stats.duration = Date.now() - startTime;
  return stats;
}

async function main() {
  const args = process.argv.slice(2);
  let category: Category | null = null;
  let limit: number | null = null;
  let skipExisting = true;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--category' && i + 1 < args.length) {
      category = args[i + 1] as Category;
      i++;
    } else if (args[i] === '--limit' && i + 1 < args.length) {
      limit = parseInt(args[i + 1], 10);
      if (isNaN(limit)) {
        console.error('Invalid limit value');
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--skip-existing') {
      skipExisting = true;
    } else if (args[i] === '--force') {
      skipExisting = false;
    }
  }

  try {
    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // Load items
    let items: FeedItem[];
    if (category) {
      logger.info(`Loading items for category: ${category}`);
      items = await loadItemsByCategory(category, 365); // Load last year's items
    } else {
      logger.info('Loading all items from database...');
      items = await loadAllItems();
    }

    if (items.length === 0) {
      logger.info('No items found in database');
      process.exit(0);
    }

    logger.info(`Found ${items.length} items`);

    // Apply limit if specified
    if (limit && limit > 0) {
      items = items.slice(0, limit);
      logger.info(`Limited to ${items.length} items`);
    }

    // Generate embeddings
    const stats = await populateEmbeddings(items, skipExisting);

    // Print summary
    console.log('\n📊 Embedding Generation Summary');
    console.log('═══════════════════════════════════════');
    console.log(`Total items:        ${stats.total}`);
    console.log(`Skipped (existing): ${stats.skipped}`);
    console.log(`Generated:          ${stats.generated}`);
    console.log(`Failed:             ${stats.failed}`);
    console.log(`Duration:           ${(stats.duration / 1000).toFixed(1)}s`);
    console.log(`Rate:               ${(stats.generated / (stats.duration / 1000)).toFixed(1)} embeddings/sec`);
    console.log('═══════════════════════════════════════\n');

    if (stats.generated > 0) {
      logger.info(`✅ Successfully generated ${stats.generated} embeddings`);
    }
    if (stats.failed > 0) {
      logger.warn(`⚠️  ${stats.failed} embeddings failed to generate`);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Failed to populate embeddings', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

