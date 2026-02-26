#!/usr/bin/env tsx
/**
 * Clean up items in database with invalid URLs, subscription pages, or promotional titles
 * Applies the same filtering rules as the decomposition pipeline
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

// Copy of filtering logic from decompose.ts
function isValidAbsoluteUrl(url: string): boolean {
  if (!url || url.trim().length === 0) {
    return false;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function shouldExcludeUrl(url: string): boolean {
  if (!isValidAbsoluteUrl(url)) {
    return true;
  }

  const urlLower = url.toLowerCase();

  // Bad URL patterns
  const badPatterns = [
    /\/newsletters?(?:[/?#]|$)/i,
    /\/issues?(?:[/?#]|$)/i,
    /\/archive(?:[/?#]|$)/i,
    /\/(advertise|sponsor|advertising|partnership|ad-?service|advert|commerci)(?:[/?#]|$)/i,
    /\/(privacy|terms|policies|legal|disclaimer)(?:[/?#]|$)/i,
    /\/(unsubscribe|preferences|settings|manage|opt-?out)(?:[/?#]|$)/i,
    /\/(media-kit|press|about|contact|info|help)(?:[/?#]|$)/i,
    /\/(feeds?|rss|subscribe|signup|join|register|login|sign-?in)(?:[/?#]|$)/i,
    /reddit\.com\/r\//i,
    /reddit\.com\/u\//i,
    /linktrak\.io/i,
    /click\.linksynergy\.com/i,
    /\.eventbrite\.com\/([\w-]+)?(?:[/?#]|$)/i,
  ];

  for (const pattern of badPatterns) {
    if (pattern.test(url)) {
      return true;
    }
  }

  // Subscription keywords
  const subscriptionKeywords = [
    '/subscribe',
    '/signup',
    '/sign-up',
    '/join',
    '/register',
    'subscribe?',
    'signup?',
    '?subscribe',
    '?signup',
    'utm_campaign=email-home',
    'utm_campaign=email-subscribe',
  ];

  if (subscriptionKeywords.some(keyword => urlLower.includes(keyword))) {
    return true;
  }

  // Filter Substack URLs
  if (url.includes('.substack.com') || url.includes('substack.com/')) {
    if (!url.includes('/p/')) {
      return true;
    }
    if (/\.substack\.com\/p\/?(\?|$|#)/i.test(url)) {
      return true;
    }
    // Reject subscription/payment pages even if they have /p/
    if (urlLower.includes('/subscribe') || urlLower.includes('/payment') || urlLower.includes('/checkout') || urlLower.includes('/upgrade')) {
      return true;
    }
  }

  // Filter Substack user profile pages
  if (/substack\.com\/@[\w-]+$/i.test(url) || /substack\.com\/@[\w-]+\/?$/i.test(url)) {
    return true;
  }

  // Filter localhost URLs
  if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) {
    return true;
  }

  // Filter homepage URLs
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const hasOnlyRootPath = pathname === '/' || pathname === '';
    if (hasOnlyRootPath) {
      if (!parsed.hash || parsed.hash === '#') {
        return true;
      }
    }
  } catch {
    // URL parsing failed
  }

  // Filter known newsletter domain homepages
  // Filter known newsletter domain homepages that don't have article paths
  // BUT: Preserve TLDR tracking links (links.tldrnewsletter.com) as they point to real articles
  if (urlLower.includes('links.tldrnewsletter.com')) {
    return false; // These are valid tracking links to articles
  }

  const newsletterDomains = ['tldr.tech', 'tldrnewsletter.com', 'pointer.io', 'bytebytego.com'];
  for (const domain of newsletterDomains) {
    if (urlLower.includes(domain)) {
      // Skip if it's a TLDR tracking link
      if (domain === 'tldrnewsletter.com' && urlLower.includes('links.tldrnewsletter.com')) {
        continue;
      }
      const domainPattern = new RegExp(`https?://(www\\.)?${domain.replace(/\./g, '\\.')}/?([?#]|$)`, 'i');
      if (domainPattern.test(url)) {
        return true;
      }
      const homepagePaths = ['/', '/home', '/index', '/welcome', '/start'];
      const pathMatch = url.match(new RegExp(`https?://[^/]+/([^?#]+)`, 'i'));
      if (pathMatch && homepagePaths.includes('/' + pathMatch[1].toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

function shouldExcludeTitle(title: string): boolean {
  if (!title) return false;
  const badTitlePatterns = [
    /^advertise$/i,
    /^sponsor$/i,
    /^advertisement$/i,
    /^promotional content$/i,
    /^(subscribe|join|sign up)$/i,
    /subscribe to .* (newsletter|publication)/i,
    /^(the|subscribe|get) .* (in|for) \d{4}$/i,
    /.* (in|for) \d{4}$/i,
    /your favorite substacker/i,
    /favorite substacker/i,
    /become a (paid|premium) subscriber/i,
    /upgrade to (paid|premium)/i,
  ];
  for (const pattern of badTitlePatterns) {
    if (pattern.test(title.trim())) {
      return true;
    }
  }
  return false;
}

async function cleanupInvalidUrls() {
  try {
    await initializeDatabase();
    const client = await getDbClient();

    console.log('\n🧹 Cleaning up items with invalid URLs, subscription pages, or promotional titles\n');
    console.log('='.repeat(80));

    // Find items with invalid URLs
    const invalidUrlItems = await client.query(
      `SELECT id, title, url, category, source_title, published_at
       FROM items
       WHERE url IS NULL OR url = '' OR url LIKE '%localhost%' OR url LIKE '%127.0.0.1%'`
    );

    // Find items with clearly problematic URLs (subscription pages, localhost, etc.)
    // Only check items that are likely to be problematic, not all items
    // NOTE: We preserve TLDR tracking links (links.tldrnewsletter.com) as they point to real articles
    const problematicUrlItems = await client.query(
      `SELECT id, title, url, category, source_title, published_at
       FROM items
       WHERE url IS NOT NULL AND url != ''
         AND (
           url LIKE '%localhost%' OR url LIKE '%127.0.0.1%'
           OR url LIKE '%/subscribe%' OR url LIKE '%subscribe?%' OR url LIKE '%?subscribe%'
           OR url LIKE '%/signup%' OR url LIKE '%/join%'
           OR (url LIKE '%substack.com%' AND url NOT LIKE '%/p/%')
           OR url LIKE '%substack.com/redirect/%'
           -- TLDR: filter homepages, ads, web-version, referral links, but NOT tracking links (links.tldrnewsletter.com)
           OR url LIKE '%tldr.tech/%' OR url LIKE '%tldrnewsletter.com/%'
           OR url LIKE '%advertise.tldr.tech%'
           OR url LIKE '%a.tldrnewsletter.com/web-version%'
           OR url LIKE '%refer.tldr.tech%'
           OR url LIKE '%jobs.ashbyhq.com/tldr.tech%'
           -- Pointer and ByteByteGo homepages
           OR url LIKE '%pointer.io/%' OR url LIKE '%bytebytego.com/%'
         )`
    );

    const excludedUrlItems: Array<{ id: string; title: string; url: string; reason: string }> = [];
    for (const row of problematicUrlItems.rows) {
      const item = row as Record<string, unknown>;
      const url = String(item.url);
      // Only exclude if it's clearly a subscription page or invalid URL
      if (shouldExcludeUrl(url)) {
        excludedUrlItems.push({
          id: String(item.id),
          title: String(item.title),
          url: url,
          reason: 'excluded URL pattern',
        });
      }
    }

    // Find items with excluded titles (promotional content)
    const excludedTitleItems = await client.query(
      `SELECT id, title, url, category, source_title, published_at
       FROM items
       WHERE title ILIKE '%favorite substacker%'
          OR title ILIKE '%become a paid subscriber%'
          OR title ILIKE '%become a premium subscriber%'
          OR title ILIKE '%upgrade to paid%'
          OR title ILIKE '%upgrade to premium%'
          OR title ILIKE 'subscribe to % newsletter%'
          OR title ILIKE 'subscribe to % publication%'
          OR title = 'advertise'
          OR title = 'sponsor'
          OR title = 'advertisement'
          OR title = 'promotional content'`
    );

    const excludedTitleItemsList: Array<{ id: string; title: string; url: string; reason: string }> = [];
    for (const row of excludedTitleItems.rows) {
      const item = row as Record<string, unknown>;
      const title = String(item.title);
      // Double-check with the function
      if (shouldExcludeTitle(title)) {
        excludedTitleItemsList.push({
          id: String(item.id),
          title: title,
          url: String(item.url || ''),
          reason: 'excluded title pattern',
        });
      }
    }

    // Combine all items to delete (avoid duplicates)
    const itemsToDelete = new Map<string, { id: string; title: string; url: string; reason: string }>();

    for (const item of invalidUrlItems.rows) {
      const row = item as Record<string, unknown>;
      itemsToDelete.set(String(row.id), {
        id: String(row.id),
        title: String(row.title),
        url: String(row.url || ''),
        reason: 'invalid/empty URL',
      });
    }

    for (const item of excludedUrlItems) {
      itemsToDelete.set(item.id, item);
    }

    for (const item of excludedTitleItemsList) {
      itemsToDelete.set(item.id, item);
    }

    const totalToDelete = itemsToDelete.size;

    if (totalToDelete === 0) {
      console.log('✅ No items found that need cleanup');
      console.log('='.repeat(80) + '\n');
      return;
    }

    console.log(`\n📊 Found ${totalToDelete} items to delete:\n`);
    console.log(`  - ${invalidUrlItems.rows.length} with invalid/empty URLs`);
    console.log(`  - ${excludedUrlItems.length} with excluded URL patterns (subscription pages, etc.)`);
    console.log(`  - ${excludedTitleItemsList.length} with excluded title patterns (promotional content)`);
    const duplicates = totalToDelete - invalidUrlItems.rows.length - excludedUrlItems.length - excludedTitleItemsList.length;
    if (duplicates > 0) {
      console.log(`  - ${duplicates} duplicates (matched multiple criteria)\n`);
    } else {
      console.log('');
    }

    // Show sample items
    console.log('Sample items to be deleted:\n');
    let count = 0;
    for (const item of itemsToDelete.values()) {
      if (count++ >= 10) break;
      console.log(`  - "${item.title.substring(0, 50)}..."`);
      console.log(`    URL: ${item.url.substring(0, 60)}...`);
      console.log(`    Reason: ${item.reason}`);
      console.log('');
    }
    if (totalToDelete > 10) {
      console.log(`  ... and ${totalToDelete - 10} more\n`);
    }

    // Ask for confirmation
    console.log('⚠️  This will DELETE these items from the database.');
    console.log('   Related data (scores, embeddings, etc.) will also be deleted via CASCADE.\n');

    // For script usage, we'll use a command-line flag
    const shouldDelete = process.argv.includes('--delete');

    if (!shouldDelete) {
      console.log('💡 Run with --delete flag to actually delete the items:');
      console.log('   npx tsx scripts/cleanup-invalid-urls.ts --delete\n');
      return;
    }

    // Delete items
    const itemIds = Array.from(itemsToDelete.keys());
    console.log(`\n🗑️  Deleting ${itemIds.length} items...\n`);

    // Delete in batches to avoid query size limits
    const batchSize = 100;
    let deletedCount = 0;

    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(', ');

      const result = await client.query(
        `DELETE FROM items WHERE id IN (${placeholders})`,
        batch
      );

      deletedCount += result.rowCount || 0;
      console.log(`  Deleted batch ${Math.floor(i / batchSize) + 1}: ${result.rowCount || 0} items`);
    }

    console.log(`\n✅ Successfully deleted ${deletedCount} items`);
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    logger.error('Failed to cleanup invalid URLs', error);
    console.error('Error:', error);
    process.exit(1);
  }
}

cleanupInvalidUrls();

