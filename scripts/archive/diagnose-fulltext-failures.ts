#!/usr/bin/env npx tsx

/**
 * Diagnose why full text population has low coverage
 * 
 * Analyzes:
 * 1. Items that were never attempted (full_text_source IS NULL)
 * 2. Items that failed (full_text_source = 'error')
 * 3. Common patterns in failures (domain, source title, etc.)
 * 
 * Run with: npx tsx scripts/diagnose-fulltext-failures.ts
 */

import { getSqlite } from "../src/lib/db/index";
import { logger } from "../src/lib/logger";

interface FailurePattern {
  type: string;
  count: number;
  percentage: number;
  examples: string[];
}

async function main() {
  try {
    const sqlite = getSqlite();

    logger.info("🔍 Full Text Population Diagnosis\n");

    // 1. Coverage by category
    logger.info("1️⃣  Coverage by Category");
    logger.info("========================\n");

    const coverageByCategory = sqlite
      .prepare(
        `
      SELECT
        category,
        COUNT(*) as total,
        SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
        SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END) as never_attempted,
        ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_cached
      FROM items
      GROUP BY category
      ORDER BY pct_cached DESC
    `
      )
      .all() as Array<{
      category: string;
      total: number;
      cached: number;
      errors: number;
      never_attempted: number;
      pct_cached: number;
    }>;

    for (const row of coverageByCategory) {
      const status =
        row.pct_cached >= 80
          ? "✅"
          : row.pct_cached >= 50
            ? "🟡"
            : row.pct_cached >= 25
              ? "🟠"
              : "🔴";

      logger.info(`${status} ${row.category.padEnd(20)} ${row.cached}/${row.total} (${row.pct_cached}%)`);
      logger.info(`   └─ Never attempted: ${row.never_attempted}, Errors: ${row.errors}\n`);
    }

    // 2. Top failing sources (for low-coverage categories)
    logger.info("\n2️⃣  Top Failing Sources");
    logger.info("======================\n");

    const lowCoverageCategories = ["tech_articles", "community", "product_news"];

    for (const category of lowCoverageCategories) {
      logger.info(`\n${category}:`);

      const failingSources = sqlite
        .prepare(
          `
        SELECT
          source_title,
          COUNT(*) as total,
          SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
          SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END) as errors,
          SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END) as never_attempted,
          ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as coverage
        FROM items
        WHERE category = ?
        GROUP BY source_title
        ORDER BY never_attempted DESC
        LIMIT 5
      `
        )
        .all(category) as Array<{
        source_title: string;
        total: number;
        cached: number;
        errors: number;
        never_attempted: number;
        coverage: number;
      }>;

      for (const source of failingSources) {
        logger.info(
          `  • ${source.source_title.substring(0, 40).padEnd(40)} ${source.cached}/${source.total} (${source.coverage}%)`
        );
        if (source.never_attempted > 0) {
          logger.info(`    Never attempted: ${source.never_attempted}`);
        }
        if (source.errors > 0) {
          logger.info(`    Errors: ${source.errors}`);
        }
      }
    }

    // 3. Reasons for "never attempted"
    logger.info("\n\n3️⃣  Why Were Items Never Attempted?");
    logger.info("===================================\n");

    const neverAttemptedItems = sqlite
      .prepare(
        `
      SELECT
        category,
        url,
        source_title
      FROM items
      WHERE full_text IS NULL AND full_text_source IS NULL
      ORDER BY category
      LIMIT 10
    `
      )
      .all() as Array<{ category: string; url: string; source_title: string }>;

    logger.info("Sample never-attempted items:");
    for (const item of neverAttemptedItems) {
      logger.info(`  [${item.category}] ${item.source_title}`);
      logger.info(`    URL: ${item.url.substring(0, 60)}...`);
    }

    // 4. Domain analysis for errors
    logger.info("\n\n4️⃣  Error Patterns (by domain)");
    logger.info("==============================\n");

    const errorPatterns = sqlite
      .prepare(
        `
      SELECT
        CASE
          WHEN url LIKE '%hacker%' THEN 'Hacker News'
          WHEN url LIKE '%reddit%' THEN 'Reddit'
          WHEN url LIKE '%economist%' THEN 'Economist (paywall)'
          WHEN url LIKE '%wsj%' THEN 'WSJ (paywall)'
          WHEN url LIKE '%github%' THEN 'GitHub'
          WHEN url LIKE '%medium%' THEN 'Medium'
          WHEN url LIKE '%substack%' THEN 'Substack'
          WHEN url LIKE '%arxiv%' THEN 'arXiv'
          ELSE 'Other'
        END as domain_type,
        COUNT(*) as total,
        SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END) as never_attempted
      FROM items
      WHERE full_text IS NULL
      GROUP BY domain_type
      ORDER BY never_attempted DESC
    `
      )
      .all() as Array<{
      domain_type: string;
      total: number;
      errors: number;
      never_attempted: number;
    }>;

    for (const pattern of errorPatterns) {
      const errorRate = Math.round((pattern.errors / pattern.total) * 100);
      logger.info(`${pattern.domain_type.padEnd(20)} ${pattern.total.toString().padEnd(5)} items`);
      logger.info(
        `  • Errors: ${pattern.errors} (${errorRate}%), Never attempted: ${pattern.never_attempted}\n`
      );
    }

    // 5. Recommendations
    logger.info("\n\n5️⃣  Recommendations");
    logger.info("===================\n");

    const stats = sqlite
      .prepare(
        `
      SELECT
        SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END) as never_attempted,
        SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END) as errors
      FROM items
    `
      )
      .get() as { never_attempted: number; errors: number };

    logger.info(`Items never attempted: ${stats.never_attempted}`);
    logger.info(`Items with errors: ${stats.errors}`);

    if (stats.never_attempted > 0) {
      logger.info(
        `\n⚠️  ACTION REQUIRED: Run population script on never-attempted items:\n`
      );
      logger.info(`   npx tsx scripts/populate-fulltext-fast.ts\n`);
      logger.info(`   OR\n`);
      logger.info(`   curl -X POST http://localhost:3002/api/admin/fulltext/fetch\n`);
    }

    if (stats.errors > 0) {
      logger.info(`\n💡 TIP: ${stats.errors} items had fetch errors (likely paywalls/connectivity)`);
      logger.info(`   These can be retried later with:\n`);
      logger.info(`   curl -X POST http://localhost:3002/api/admin/fulltext/fetch -d '{"skip_cached":false}'\n`);
    }

    logger.info(
      `\n✅ Diagnosis complete. Check logs above for low-coverage categories to prioritize.\n`
    );
  } catch (error) {
    logger.error("Diagnosis failed", { error });
    process.exit(1);
  }
}

main();
