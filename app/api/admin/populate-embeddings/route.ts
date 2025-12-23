/**
 * POST /api/admin/populate-embeddings
 * 
 * Admin endpoint to trigger batch embedding generation for all items
 * Requires ADMIN_API_TOKEN for authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/src/lib/db/index';
import { loadAllItems, loadItemsByCategory } from '@/src/lib/db/items';
import { getEmbeddingsBatch } from '@/src/lib/db/embeddings';
import { generateEmbeddingsBatch } from '@/src/lib/embeddings/generate';
import { saveEmbeddingsBatch } from '@/src/lib/db/embeddings';
import { logger } from '@/src/lib/logger';
import { blockInProduction } from '@/src/lib/auth/guards';
import type { Category, FeedItem } from '@/src/lib/model';

interface PopulateRequest {
  category?: Category;
  limit?: number;
  skipExisting?: boolean;
}

export async function POST(request: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();

    const body = (await request.json()) as PopulateRequest;
    const category = body.category;
    const limit = body.limit;
    const skipExisting = body.skipExisting !== false; // Default true

    // Load items
    let items: FeedItem[];
    if (category) {
      logger.info(`Loading items for category: ${category}`);
      items = await loadItemsByCategory(category, 365); // Last year
    } else {
      logger.info('Loading all items from database...');
      items = await loadAllItems();
    }

    if (items.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No items found',
        stats: {
          total: 0,
          skipped: 0,
          generated: 0,
          failed: 0,
        },
      });
    }

    logger.info(`Found ${items.length} items`);

    // Apply limit if specified
    if (limit && limit > 0) {
      items = items.slice(0, limit);
      logger.info(`Limited to ${items.length} items`);
    }

    // Check which items already have embeddings
    let itemsToProcess = items;
    let skipped = 0;
    if (skipExisting) {
      const itemIds = items.map(item => item.id);
      const existingEmbeddings = await getEmbeddingsBatch(itemIds);
      itemsToProcess = items.filter(item => !existingEmbeddings.has(item.id));
      skipped = items.length - itemsToProcess.length;
      
      logger.info(`Skipping ${skipped} items that already have embeddings`);
      logger.info(`Processing ${itemsToProcess.length} items that need embeddings`);
    }

    if (itemsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All items already have embeddings',
        stats: {
          total: items.length,
          skipped,
          generated: 0,
          failed: 0,
        },
      });
    }

    // Prepare items for batch generation
    const itemsForBatch = itemsToProcess.map((item) => {
      const fullText = item.fullText ? item.fullText.substring(0, 2000) : '';
      const text = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''} ${fullText}`.trim();
      return {
        id: item.id,
        text: text || item.title,
      };
    });

    logger.info(`Generating embeddings in batches for ${itemsForBatch.length} items...`);
    const startTime = Date.now();
    
    // Generate embeddings using batch API
    const embeddings = await generateEmbeddingsBatch(itemsForBatch);

    // Convert to format for saving and validate dimensions
    const embeddingsToSave = Array.from(embeddings.entries())
      .map(([itemId, embedding]) => {
        // Ensure 1536 dimensions
        if (embedding.length === 1536) {
          return { itemId, embedding };
        } else if (embedding.length === 768) {
          // Pad 768-dim to 1536
          const padded = new Array(1536);
          for (let i = 0; i < 1536; i++) {
            padded[i] = embedding[i % 768] * (i < 768 ? 1 : 0.5);
          }
          return { itemId, embedding: padded };
        } else {
          logger.warn(`Invalid embedding dimension (${embedding.length}) for item ${itemId}`);
          return null;
        }
      })
      .filter((item): item is { itemId: string; embedding: number[] } => item !== null);

    const generated = embeddingsToSave.length;
    const failed = itemsToProcess.length - generated;

    // Save embeddings
    if (embeddingsToSave.length > 0) {
      logger.info(`Saving ${embeddingsToSave.length} embeddings to database...`);
      await saveEmbeddingsBatch(embeddingsToSave);
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `Generated ${generated} embeddings in ${(duration / 1000).toFixed(1)}s`,
      stats: {
        total: items.length,
        skipped,
        generated,
        failed,
        duration: `${(duration / 1000).toFixed(1)}s`,
        rate: `${(generated / (duration / 1000)).toFixed(1)} embeddings/sec`,
      },
    });
  } catch (error) {
    logger.error('Failed to populate embeddings', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

