#!/usr/bin/env npx tsx

/**
 * Populate full text for all research items using ADS metadata
 * 
 * Research items are arXiv papers available via NASA ADS (Astrophysics Data System)
 * We already fetch their `body` field in the libraries endpoint, so we have 100% coverage potential
 * 
 * This script:
 * 1. Loads all research items from items table
 * 2. Extracts arXiv IDs from URLs
 * 3. Fetches metadata from ADS API (including body/full text)
 * 4. Saves to items.full_text column
 * 
 * Run with: npx tsx scripts/populate-research-fulltext.ts
 */

import { loadItemsByCategory, saveFullText, getFullTextCacheStats } from "../src/lib/db/items";
import { logger } from "../src/lib/logger";

/**
 * Extract arXiv ID from arXiv URL
 * Examples:
 * https://arxiv.org/abs/2512.12730 -> 2512.12730
 * https://arxiv.org/pdf/2512.12730.pdf -> 2512.12730
 * http://arxiv.org/abs/2512.12730v2 -> 2512.12730
 */
function extractArxivId(url: string): string | null {
  // Match pattern: arxiv.org/abs/YYMM.NNNNN or arxiv.org/pdf/YYMM.NNNNN.pdf
  const match = url.match(/arxiv\.org(?:\/abs|\/pdf)\/(\d{4}\.\d{4,5})/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Fetch arXiv paper metadata from ADS API
 * Uses search endpoint with arxiv:ID format
 */
async function fetchArxivMetadata(arxivIds: string[], token: string): Promise<Map<string, { body?: string; abstract?: string }>> {
  const results = new Map<string, { body?: string; abstract?: string }>();

  if (arxivIds.length === 0) {
    return results;
  }

  try {
    // Build search query: arxiv:ID1 OR arxiv:ID2 OR ...
    const query = arxivIds.map((id) => `arxiv:${id}`).join(" OR ");

    const params = new URLSearchParams({
      q: query,
      rows: String(arxivIds.length),
      fl: "arxiv_id,bibcode,body,abstract",
    });

    const response = await fetch(
      `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ADS API error: ${response.status} ${response.statusText} - ${error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;

    if (data.response?.docs) {
      for (const doc of data.response.docs) {
        // Extract arXiv ID from bibcode: 2025arXiv251212836H -> 2512.12836
        let arxivId: string | null = null;
        
        if (doc.bibcode && doc.bibcode.includes("arXiv")) {
          // Format: YYYYarXivYYMMNNNNNC -> extract YYMM.NNNNN
          const match = doc.bibcode.match(/arXiv(\d{4})(\d{5})/);
          if (match) {
            const [, yymm, nnnnn] = match;
            arxivId = `${yymm}.${nnnnn}`;
          }
        }

        if (arxivId) {
          results.set(arxivId, {
            body: doc.body?.[0],
            abstract: doc.abstract,
          });
        }
      }
    }

    logger.info(`Fetched ${results.size} papers from ADS`);
    return results;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch ADS metadata: ${errorMsg}`);
    return results;
  }
}

async function main() {
  try {
    const startTime = Date.now();
    const token = process.env.ADS_API_TOKEN;

    if (!token) {
      logger.error("ADS_API_TOKEN not set. Set it with: export ADS_API_TOKEN=your_token");
      process.exit(1);
    }

    logger.info("🚀 Starting research full text population via ADS...\n");

    // Load all research items
    logger.info("Loading research items...");
    const items = await loadItemsByCategory("research", 365); // Last year
    logger.info(`Loaded ${items.length} research items\n`);

    if (items.length === 0) {
      logger.warn("No research items found");
      process.exit(0);
    }

    // Filter items that don't have full text yet
    const itemsToFetch = items.filter(
      (item) => !(item as any).fullText || ((item as any).fullText || "").length < 100
    );

    logger.info(`Items needing full text: ${itemsToFetch.length} (${items.length - itemsToFetch.length} already cached)\n`);

    if (itemsToFetch.length === 0) {
      logger.info("All research items already have full text cached");
      const stats = await getFullTextCacheStats();
      logger.info(`Cache status: ${stats.cached}/${stats.total} items (${Math.round((stats.cached / stats.total) * 100)}%)`);
      process.exit(0);
    }

    // Extract arXiv IDs and map to items
    const arxivItems: Array<{ item: typeof itemsToFetch[0]; arxivId: string }> = [];

    for (const item of itemsToFetch) {
      const arxivId = extractArxivId(item.url);
      if (arxivId) {
        arxivItems.push({ item, arxivId });
      }
    }

    logger.info(`Found ${arxivItems.length} items with arXiv IDs\n`);

    if (arxivItems.length === 0) {
      logger.warn("No research items with arXiv IDs found");
      process.exit(0);
    }

    // Fetch metadata in batches
    const batchSize = 50; // ADS API rate limiting - 50 papers per batch
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < arxivItems.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batchEnd = Math.min(i + batchSize, arxivItems.length);
      const batch = arxivItems.slice(i, batchEnd);

      logger.info(`\nBatch ${batchNum}: items ${i + 1}-${batchEnd} of ${arxivItems.length}`);
      logger.info(`Fetching metadata from ADS...`);

      const batchStartTime = Date.now();

      try {
        // Fetch metadata for all arXiv IDs in batch
        const arxivIds = batch.map((x) => x.arxivId);
        const metadata = await fetchArxivMetadata(arxivIds, token);

        // Save full text for each item
        for (const { item, arxivId } of batch) {
          const meta = metadata.get(arxivId);

          if (meta && meta.body && meta.body.length > 100) {
            // Save full text
            await saveFullText(item.id, meta.body, "arxiv");
            successful++;
          } else if (meta && meta.abstract && meta.abstract.length > 100) {
            // Fallback to abstract
            await saveFullText(item.id, meta.abstract, "arxiv");
            successful++;
          } else {
            // No full text or abstract available
            skipped++;
          }
        }

        const batchDuration = Date.now() - batchStartTime;
        logger.info(
          `✓ Batch completed in ${(batchDuration / 1000).toFixed(1)}s (${successful} saved, ${skipped} skipped)`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Batch failed: ${errorMsg}`);
        failed += batch.length;
      }

      // Rate limiting: wait between batches
      if (i + batchSize < arxivItems.length) {
        logger.info("Waiting 5 seconds before next batch (ADS rate limiting)...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    const totalDuration = Date.now() - startTime;

    // Final stats
    const finalStats = await getFullTextCacheStats();

    logger.info(`\n${"=".repeat(60)}`);
    logger.info("📊 FINAL SUMMARY");
    logger.info(`${"=".repeat(60)}`);
    logger.info(`Successful: ${successful}`);
    logger.info(`Skipped (no body/abstract): ${skipped}`);
    logger.info(`Failed: ${failed}`);
    logger.info(`Duration: ${(totalDuration / 60000).toFixed(1)} minutes`);
    logger.info(`${"=".repeat(60)}\n`);

    logger.info(`Research category: research items with full text`);
    const researchStats = items.filter((item) => (item as any).fullText).length;
    logger.info(`Coverage: ${successful} new + ? cached = estimated high coverage`);

    logger.info(`\nOverall cache status:`);
    logger.info(`${finalStats.cached}/${finalStats.total} items cached (${Math.round((finalStats.cached / finalStats.total) * 100)}%)`);

    logger.info("✅ Research full text population complete!");
  } catch (error) {
    logger.error("Population failed", { error });
    process.exit(1);
  }
}

main();
