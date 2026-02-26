#!/usr/bin/env npx tsx
/**
 * Check newsletter items for full text status, especially "Roam" (e.g. from TLDR - Topics).
 * Run against production DB: DATABASE_URL in .env.local
 *
 * Usage:
 *   npx tsx scripts/archive/check-newsletter-fulltext-roam.ts
 *   TITLE=roam npx tsx scripts/archive/check-newsletter-fulltext-roam.ts  # search title (default: roam)
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

import { initializeDatabase } from "../../src/lib/db/index";
import { getDbClient, detectDriver } from "../../src/lib/db/driver";
import { looksLikeHtml } from "../../src/lib/pipeline/fulltext";

async function main() {
  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();
  const titleFilter = (process.env.TITLE || "roam").toLowerCase();

  console.log("=== Newsletter full text check ===\n");
  console.log(`Driver: ${driver}`);
  console.log(`Title filter: "${titleFilter}"\n`);

  const pg = driver === "postgres";

  // 1) Items whose title contains the filter (e.g. "roam")
  const searchQuery = pg
    ? `SELECT id, title, source_title, url,
        LENGTH(full_text) AS full_text_len,
        full_text_source,
        LEFT(full_text, 200) AS full_text_preview
       FROM items
       WHERE category = 'newsletters' AND LOWER(title) LIKE $1
       ORDER BY created_at DESC
       LIMIT 20`
    : `SELECT id, title, source_title, url,
        LENGTH(full_text) AS full_text_len,
        full_text_source,
        SUBSTR(full_text, 1, 200) AS full_text_preview
       FROM items
       WHERE category = 'newsletters' AND LOWER(title) LIKE ?
       ORDER BY created_at DESC
       LIMIT 20`;

  const searchParams = [`%${titleFilter}%`];
  const searchResult = await client.query(searchQuery, searchParams);

  console.log(`Newsletter items with title containing "${titleFilter}": ${searchResult.rows.length}\n`);

  for (const row of searchResult.rows as Array<{
    id: string;
    title: string;
    source_title: string;
    url: string;
    full_text_len: number | null;
    full_text_source: string | null;
    full_text_preview: string | null;
  }>) {
    const len = row.full_text_len ?? 0;
    const hasFullText = len >= 100;
    const preview = row.full_text_preview ?? "";
    const looksLikeHtmlPreview = looksLikeHtml(preview);

    console.log(`  Title: ${row.title?.substring(0, 70)}${row.title && row.title.length > 70 ? "..." : ""}`);
    console.log(`  ID: ${row.id}`);
    console.log(`  Source: ${row.source_title}`);
    console.log(`  Full text: ${hasFullText ? `${len} chars (${row.full_text_source ?? "unknown"})` : "MISSING or short"}`);
    if (hasFullText && looksLikeHtmlPreview) {
      console.log(`  ⚠️  Full text preview looks like HTML (will be stripped at read time)`);
    }
    if (preview) {
      console.log(`  Preview: ${preview.substring(0, 100).replace(/\n/g, " ")}...`);
    }
    console.log("");
  }

  // 2) Count newsletters missing full text
  const missingQuery = pg
    ? `SELECT COUNT(*) AS c FROM items WHERE category = 'newsletters' AND (full_text IS NULL OR LENGTH(full_text) < 100)`
    : `SELECT COUNT(*) AS c FROM items WHERE category = 'newsletters' AND (full_text IS NULL OR LENGTH(full_text) < 100)`;
  const missingResult = await client.query(missingQuery, []);
  const missingCount =
    driver === "postgres"
      ? parseInt((missingResult.rows[0] as { c: string }).c, 10)
      : (missingResult.rows[0] as { c: number }).c;

  const totalQuery = pg
    ? `SELECT COUNT(*) AS c FROM items WHERE category = 'newsletters'`
    : `SELECT COUNT(*) AS c FROM items WHERE category = 'newsletters'`;
  const totalResult = await client.query(totalQuery, []);
  const totalCount =
    driver === "postgres"
      ? parseInt((totalResult.rows[0] as { c: string }).c, 10)
      : (totalResult.rows[0] as { c: number }).c;

  console.log("--- Summary ---");
  console.log(`Newsletters total: ${totalCount}`);
  console.log(`Newsletters missing/short full text: ${missingCount}`);
  console.log("\nTo backfill newsletters only: CATEGORY=newsletters npx tsx scripts/archive/backfill-fulltext-production.ts");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
