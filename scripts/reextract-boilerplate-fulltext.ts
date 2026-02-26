#!/usr/bin/env npx tsx

/**
 * Re-extract full text for items that have subscription boilerplate
 * instead of actual article content.
 *
 * This script:
 * 1. Finds items with subscription boilerplate fulltext
 * 2. Decodes tracking URLs to get the real article URL
 * 3. Updates the URL in the database
 * 4. Re-fetches fulltext from the correct URL
 *
 * Run with: npx tsx scripts/reextract-boilerplate-fulltext.ts
 */

import { getDbClient } from "../src/lib/db/driver";
import { fetchFullText } from "../src/lib/pipeline/fulltext";
import { logger } from "../src/lib/logger";

/**
 * Decode tracking URLs to get the actual destination
 */
function decodeTrackingUrl(url: string): string {
  // Substack redirect: https://substack.com/redirect/2/BASE64_JSON
  if (url.includes('substack.com/redirect/')) {
    const base64Match = url.match(/substack\.com\/redirect\/\d+\/([A-Za-z0-9_-]+)/);
    if (base64Match) {
      try {
        const base64 = base64Match[1].replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(base64, 'base64').toString('utf-8');
        const payload = JSON.parse(decoded);
        if (payload.e && typeof payload.e === 'string') {
          return payload.e;
        }
      } catch { }
    }
  }

  // ConvertKit: https://xxx.click.convertkit-mail2.com/.../BASE64_ENCODED_URL
  if (url.includes('convertkit-mail') || url.includes('convertkit.com')) {
    const parts = url.split('/');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length > 20) {
      try {
        const decoded = Buffer.from(lastPart, 'base64').toString('utf-8');
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded;
        }
      } catch { }
    }
  }

  return url;
}

/**
 * Extract actual article URL from subscribe/redirect pages
 */
function extractArticleUrl(url: string): string {
  // First decode any tracking wrapper
  let decodedUrl = decodeTrackingUrl(url);

  // Check if it's a subscribe page with a next/redirect param
  try {
    const urlObj = new URL(decodedUrl);
    const urlLower = decodedUrl.toLowerCase();

    // Check for subscription paths
    const isSubscribePage = ['/subscribe', '/signup', '/membership', '/join'].some(
      path => urlLower.includes(path)
    );

    if (isSubscribePage) {
      // Try to extract article URL from redirect params
      const redirectParams = ['next', 'redirect', 'url', 'return', 'return_to', 'redirect_uri', 'continue'];
      for (const param of redirectParams) {
        const redirectUrl = urlObj.searchParams.get(param);
        if (redirectUrl) {
          try {
            const redirectDecoded = decodeURIComponent(redirectUrl);
            // Check if it's a valid article URL (has /p/ path for Substack)
            if (redirectDecoded.includes('/p/') || redirectDecoded.includes('/post/') || redirectDecoded.includes('/article/')) {
              return redirectDecoded;
            }
          } catch { }
        }
      }
    }
  } catch { }

  return decodedUrl;
}

// Subscription boilerplate detection (same as in fulltext API)
function isSubscriptionBoilerplate(text: string): boolean {
  if (!text) return true;

  const textLower = text.toLowerCase();

  const subscriptionPhrases = [
    'by subscribing, i agree to',
    'terms of use',
    'privacy policy',
    'information collection notice',
    'already have an account? sign in',
    'sign in to your account',
    'create your free account',
    'subscribe to continue reading',
    'subscribe to read',
    'become a member',
    'join to unlock',
    'unlock this article',
    'this post is for paid subscribers',
    'this post is for paying subscribers',
    'upgrade to paid',
    'start your free trial',
    'subscribers only',
  ];

  let subscriptionPhraseCount = 0;
  for (const phrase of subscriptionPhrases) {
    if (textLower.includes(phrase)) {
      subscriptionPhraseCount++;
    }
  }

  if (text.length < 1000 && subscriptionPhraseCount >= 1) {
    return true;
  }

  if (subscriptionPhraseCount >= 2) {
    return true;
  }

  if (text.length < 500) {
    const subscriberMatch = textLower.match(/over\s+[\d,]+\s+subscribers?/);
    if (subscriberMatch) {
      return true;
    }
  }

  return false;
}

async function main() {
  console.log("Finding items with subscription boilerplate fulltext...\n");

  const db = await getDbClient();

  // Find items that have fulltext but it's likely boilerplate
  const result = await db.query(`
    SELECT id, title, url, full_text, full_text_source
    FROM items
    WHERE full_text IS NOT NULL
      AND LENGTH(full_text) > 0
      AND created_at > EXTRACT(EPOCH FROM NOW() - INTERVAL '30 days')
    ORDER BY created_at DESC
  `);

  const items = result.rows as Array<{
    id: string;
    title: string;
    url: string;
    full_text: string;
    full_text_source: string;
  }>;

  console.log(`Checking ${items.length} items with fulltext...\n`);

  const boilerplateItems: typeof items = [];

  for (const item of items) {
    if (isSubscriptionBoilerplate(item.full_text)) {
      boilerplateItems.push(item);
      console.log(`Found boilerplate: "${item.title.substring(0, 60)}..."`);
      console.log(`  URL: ${item.url}`);
      console.log(`  Fulltext preview: ${item.full_text.substring(0, 100)}...`);
      console.log();
    }
  }

  console.log(`\nFound ${boilerplateItems.length} items with boilerplate fulltext.\n`);

  if (boilerplateItems.length === 0) {
    console.log("No items to re-extract.");
    return;
  }

  console.log("Re-extracting fulltext from current URLs...\n");

  let successCount = 0;
  let failCount = 0;

  for (const item of boilerplateItems) {
    console.log(`Processing: "${item.title.substring(0, 50)}..."`);
    console.log(`  Original URL: ${item.url}`);

    // Extract the actual article URL
    const articleUrl = extractArticleUrl(item.url);
    if (articleUrl !== item.url) {
      console.log(`  Decoded URL: ${articleUrl}`);
    }

    // Skip if we couldn't extract a better URL
    if (articleUrl === item.url || articleUrl.includes('/subscribe') || articleUrl.includes('/membership')) {
      console.log(`  SKIPPED: Could not extract article URL`);
      failCount++;
      continue;
    }

    // Update the URL in the database
    console.log(`  Updating URL in database...`);
    await db.run(
      `UPDATE items SET url = ? WHERE id = ?`,
      [articleUrl, item.id]
    );

    try {
      const result = await fetchFullText({
        id: item.id,
        title: item.title,
        url: articleUrl,
        sourceTitle: "",
        streamId: "",
        publishedAt: new Date(),
        createdAt: new Date(),
        category: "newsletters",
        categories: [],
        raw: {},
      });

      if (result.source === "error" || result.length < 100) {
        console.log(`  FAILED: No content extracted`);
        failCount++;
        continue;
      }

      // Check if the new content is also boilerplate
      if (isSubscriptionBoilerplate(result.text)) {
        console.log(`  FAILED: New content is also boilerplate`);
        failCount++;
        continue;
      }

      // Save the new fulltext
      await db.run(
        `UPDATE items SET full_text = ?, full_text_source = ?, full_text_fetched_at = EXTRACT(EPOCH FROM NOW()) WHERE id = ?`,
        [result.text, result.source, item.id]
      );

      console.log(`  SUCCESS: Extracted ${result.length} chars from ${result.source}`);
      successCount++;
    } catch (error) {
      console.log(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
      failCount++;
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\nDone! Success: ${successCount}, Failed: ${failCount}`);
}

main().catch(console.error);
