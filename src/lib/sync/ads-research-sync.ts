/**
 * Research sync using ADS Search API instead of Inoreader
 *
 * Fetches research papers from ADS based on:
 * - Current month publication date
 * - Code intelligence related keywords
 * - Relevant arXiv CS classes
 * - Sorted by relevance
 *
 * Stores all results in database (not just top 10) for searchability
 * Includes full text from ADS body field
 */

import { logger } from '../logger';
import { Category, FeedItem } from '../model';
import { saveItems } from '../db/items';
import { computeAndSaveScoresForItems } from '../pipeline/compute-scores';
import { categorizeItems } from '../pipeline/categorize';
import { storePapersBatch } from '../db/ads-papers';
import { getArxivUrl, getADSUrl } from '../ads/client';
import { getDbClient, detectDriver } from '../db/driver';

interface ADSSearchResponse {
  response: {
    docs: Array<{
      bibcode: string;
      title?: string[];
      author?: string[];
      pubdate?: string;
      abstract?: string;
      body?: string | string[]; // Full text content
      arxiv_class?: string[];
    }>;
    numFound: number;
  };
}

/**
 * Build ADS search query for research papers
 * @param startYear Start year
 * @param startMonth Start month (1-12)
 * @param endYear End year
 * @param endMonth End month (1-12)
 */
function buildResearchQuery(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): string {
  // Format dates: YYYY-MM
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}`;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}`;

  // Build query components
  const pubdateQuery = `pubdate:[${startDate} TO ${endDate}]`;
  // Note: "information retrieval" needs to be quoted as a phrase
  const absQuery = `abs:(code OR coding OR software OR developer) AND abs:(agent OR agentic OR SDLC OR enterprise OR "code search" OR context OR "information retrieval")`;
  const arxivClasses = [
    'cs.SE', 'cs.IR', 'cs.SY', 'cs.DS', 'cs.CL', 'cs.IT', 'cs.DB',
    'cs.MA', 'cs.AI', 'cs.DC', 'cs.DL', 'cs.GL', 'cs.LG'
  ];
  const arxivQuery = arxivClasses.map(c => `arxiv_class:${c}`).join(' OR ');

  // Combine all parts with proper parentheses
  // Format: pubdate:[...] AND (abs:...) AND (arxiv_class:... OR ...)
  const fullQuery = `${pubdateQuery} AND (${absQuery}) AND (${arxivQuery})`;

  return fullQuery;
}

/**
 * Build query for current month + next month (sliding window for ongoing sync)
 */
function buildSlidingWindowQuery(year: number, month: number): string {
  // Calculate next month for date range
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return buildResearchQuery(year, month, nextYear, nextMonth);
}

/**
 * Build query for last N years (for initial backfill)
 */
function buildYearsBackQuery(yearsBack: number): string {
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1; // 1-12

  const startDate = new Date(now);
  startDate.setFullYear(endYear - yearsBack);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1; // 1-12

  return buildResearchQuery(startYear, startMonth, endYear, endMonth);
}

/**
 * Fetch research papers from ADS Search API
 * @param token ADS API token
 * @param query Pre-built ADS query string
 * @param maxResults Maximum number of results to fetch (default: 10000)
 */
async function fetchResearchPapers(
  token: string,
  query: string,
  maxResults: number = 10000
): Promise<ADSSearchResponse['response']['docs']> {
  logger.info(`[ADS-RESEARCH] Fetching research papers with query: ${query}`);

  // Fetch all results (not just top 10) - ADS allows up to 2000 rows per request
  // We'll fetch in batches if needed
  const allDocs: ADSSearchResponse['response']['docs'] = [];
  let start = 0;
  const rowsPerBatch = 2000;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({
      q: query,
      fl: 'bibcode,title,author,pubdate,abstract,body,arxiv_class',
      sort: 'score desc', // Sort by relevance
      rows: String(rowsPerBatch),
      start: String(start),
    });

    const response = await fetch(
      `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `ADS Search API error: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = (await response.json()) as ADSSearchResponse;
    const docs = data.response?.docs || [];

    allDocs.push(...docs);

    logger.info(
      `[ADS-RESEARCH] Fetched batch: ${docs.length} papers (total: ${allDocs.length}/${data.response?.numFound || 0})`
    );

    // Check if there are more results
    const totalFound = data.response?.numFound || 0;
    hasMore = allDocs.length < totalFound && docs.length === rowsPerBatch;
    start += rowsPerBatch;

    // Limit to maxResults
    if (allDocs.length >= maxResults) {
      logger.warn(`[ADS-RESEARCH] Reached ${maxResults} paper limit, stopping fetch`);
      break;
    }
  }

  logger.info(`[ADS-RESEARCH] Total papers fetched: ${allDocs.length}`);
  return allDocs;
}

/**
 * Convert ADS paper to FeedItem format
 */
function adsPaperToFeedItem(doc: ADSSearchResponse['response']['docs'][0]): FeedItem {
  const bibcode = doc.bibcode;
  const title = doc.title?.[0] || 'Untitled Paper';
  const authors = doc.author || [];
  const author = authors.length > 0 ? authors.join(', ') : undefined;

  // Parse publication date
  // Since pubdate is month-granular (e.g., "2025-12"), we set published_at to first of that month
  // This ensures all papers with the same pubdate have the same published_at
  // For backfill: all papers from same month have same published_at (treated as same age)
  // For new papers: published_at = first of month from pubdate, created_at = when synced (age increments from created_at)
  const now = new Date();
  let publishedAt: Date;
  
  if (doc.pubdate) {
    // pubdate format: "2025-12" or "2025-12-15" (month granularity)
    const dateMatch = doc.pubdate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (dateMatch) {
      const [, year, month] = dateMatch;
      // Always use first of the month (day 1) since we only have month granularity
      publishedAt = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        1 // Always first of month
      );
    } else {
      // Invalid pubdate format: use first of current month
      publishedAt = new Date(now.getFullYear(), now.getMonth(), 1);
    }
  } else {
    // No pubdate: use first of current month (month granularity)
    publishedAt = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  
  // Ensure published_at is not in the future (cap at first of current month)
  if (publishedAt > now) {
    publishedAt = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // Get URLs
  const arxivUrl = getArxivUrl(bibcode);
  const adsUrl = getADSUrl(bibcode);
  const url = arxivUrl || adsUrl;

  // Extract body (full text) - can be string or array
  const body = Array.isArray(doc.body) ? doc.body[0] : doc.body;

  // Create FeedItem
  const feedItem: FeedItem = {
    id: `ads:${bibcode}`,
    streamId: `ads:research:${bibcode}`,
    sourceTitle: 'ADS Research',
    title,
    url,
    author,
    publishedAt,
    createdAt: new Date(), // When we fetched it
    summary: doc.abstract || undefined,
    contentSnippet: doc.abstract || undefined,
    categories: ['research'],
    category: 'research',
    raw: {
      bibcode,
      adsUrl,
      arxivUrl,
      arxivClass: doc.arxiv_class || [],
    },
    fullText: body || undefined,
  };

  return feedItem;
}

/**
 * Sync research papers from ADS Search API (ongoing sync)
 * Uses a sliding month window: current month + next month
 * This ensures we catch new papers as they're published
 *
 * @param token ADS API token
 * @returns Number of items added
 */
export async function syncResearchFromADS(token: string): Promise<{
  itemsAdded: number;
  itemsScored: number;
  totalFound: number;
}> {
  logger.info('[ADS-RESEARCH] Starting ongoing research sync from ADS (sliding month window)');

  // Get current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12

  // Build query for current month + next month (sliding window)
  const query = buildSlidingWindowQuery(year, month);

  // Fetch papers from ADS (limit to 5000 for ongoing sync to avoid timeout)
  const docs = await fetchResearchPapers(token, query, 5000);

  if (docs.length === 0) {
    logger.info('[ADS-RESEARCH] No papers found for current month');
    return { itemsAdded: 0, itemsScored: 0, totalFound: 0 };
  }

  // Convert to FeedItems
  const feedItems = docs.map(adsPaperToFeedItem);
  
  logger.info(`[ADS-RESEARCH] Converted ${feedItems.length} papers to FeedItems`);
  
  // Check which papers we already have in the database to avoid reprocessing
  const itemIds = feedItems.map(item => item.id);
  const client = await getDbClient();
  const driver = detectDriver();
  
  // Build query that works for both PostgreSQL and SQLite
  let existingItemsResult;
  if (driver === 'postgres') {
    // PostgreSQL: use ANY(array)
    existingItemsResult = await client.query(
      `SELECT id FROM items WHERE id = ANY($1)`,
      [itemIds]
    );
  } else {
    // SQLite: use IN (?, ?, ...)
    const placeholders = itemIds.map(() => '?').join(',');
    existingItemsResult = await client.query(
      `SELECT id FROM items WHERE id IN (${placeholders})`,
      itemIds
    );
  }
  
  const existingIds = new Set(
    (existingItemsResult.rows as any[]).map(row => row.id)
  );
  
  // Filter out papers we already have
  const newFeedItems = feedItems.filter(item => !existingIds.has(item.id));
  
  if (newFeedItems.length === 0) {
    logger.info(`[ADS-RESEARCH] All ${feedItems.length} papers already exist in database, skipping processing`);
    return { itemsAdded: 0, itemsScored: 0, totalFound: docs.length };
  }
  
  logger.info(`[ADS-RESEARCH] ${newFeedItems.length} new papers to process (${feedItems.length - newFeedItems.length} already exist)`);
  
  // Note: normalizeItems expects InoreaderArticle[], but we have FeedItem[]
  // For ADS papers, we've already normalized them (URLs, dates, etc. are set)
  // So we can skip normalization and go straight to categorization
  // Categorize (should all be 'research' already, but ensure)
  const categorizedItems = await categorizeItems(newFeedItems);
  
  // Filter to only research items
  const researchItems = categorizedItems.filter(item => item.category === 'research');
  
  logger.info(`[ADS-RESEARCH] ${researchItems.length} items after normalization/categorization`);
  
  // Save to items table
  await saveItems(researchItems);

  // Also save to ads_papers table for full text storage
  const papersToStore = researchItems.map(item => {
    const raw = item.raw as { bibcode: string; adsUrl: string; arxivUrl?: string; arxivClass?: string[] };
    return {
      bibcode: raw.bibcode,
      title: item.title,
      authors: item.author ? JSON.stringify([item.author]) : undefined,
      pubdate: item.publishedAt.toISOString().split('T')[0], // YYYY-MM-DD format
      abstract: item.summary || item.contentSnippet || undefined,
      body: item.fullText || undefined, // Full text from ADS
      year: item.publishedAt.getFullYear(),
      journal: 'arXiv', // Most will be from arXiv
      adsUrl: raw.adsUrl,
      arxivUrl: raw.arxivUrl || null,
      fulltextSource: item.fullText ? 'ads_api' : undefined,
    };
  });

  await storePapersBatch(papersToStore);
  logger.info(`[ADS-RESEARCH] Stored ${papersToStore.length} papers in ads_papers table`);

  // Score items
  const scoreResult = await computeAndSaveScoresForItems(researchItems);

  logger.info(
    `[ADS-RESEARCH] Sync complete: ${researchItems.length} items added, ${scoreResult.totalScored} scored`
  );

  return {
    itemsAdded: researchItems.length,
    itemsScored: scoreResult.totalScored,
    totalFound: docs.length,
  };
}

/**
 * Initial backfill: Sync research papers from last 3 years
 * This should be run once to populate the database with historical papers
 * Fetches in monthly chunks to avoid timeout
 *
 * @param token ADS API token
 * @param yearsBack Number of years to go back (default: 3)
 * @returns Number of items added
 */
export async function syncResearchFromADSInitial(
  token: string,
  yearsBack: number = 3
): Promise<{
  itemsAdded: number;
  itemsScored: number;
  totalFound: number;
}> {
  logger.info(`[ADS-RESEARCH] Starting initial research backfill from ADS (last ${yearsBack} years)`);

  // Fetch in monthly chunks to avoid timeout
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1; // 1-12

  const startDate = new Date(now);
  startDate.setFullYear(endYear - yearsBack);
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1; // 1-12

  logger.info(`[ADS-RESEARCH] Fetching papers from ${startYear}-${String(startMonth).padStart(2, '0')} to ${endYear}-${String(endMonth).padStart(2, '0')} in monthly chunks`);

  let totalItemsAdded = 0;
  let totalItemsScored = 0;
  let totalFound = 0;
  let currentYear = startYear;
  let currentMonth = startMonth;

  // Iterate month by month, processing in batches to avoid memory issues
  while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
    const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const nextYear = currentMonth === 12 ? currentYear + 1 : currentYear;

    // Build query for this month
    const query = buildResearchQuery(currentYear, currentMonth, nextYear, nextMonth);

    logger.info(`[ADS-RESEARCH] Fetching month ${currentYear}-${String(currentMonth).padStart(2, '0')}...`);

    try {
      // Fetch papers for this month (limit to 2000 per month to avoid timeout)
      const monthDocs = await fetchResearchPapers(token, query, 2000);
      totalFound += monthDocs.length;

      logger.info(`[ADS-RESEARCH] Fetched ${monthDocs.length} papers for ${currentYear}-${String(currentMonth).padStart(2, '0')} (total fetched: ${totalFound})`);

      if (monthDocs.length === 0) {
        // Move to next month
        currentMonth = nextMonth;
        currentYear = nextYear;
        continue;
      }

      // Process this month's papers immediately to avoid memory buildup
      const feedItems = monthDocs.map(adsPaperToFeedItem);

      // Categorize (should all be 'research' already, but ensure)
      const categorizedItems = await categorizeItems(feedItems);

      // Filter to only research items
      const researchItems = categorizedItems.filter(item => item.category === 'research');

      if (researchItems.length > 0) {
        // Save to items table
        await saveItems(researchItems);

        // Also save to ads_papers table for full text storage
        const papersToStore = researchItems.map(item => {
          const raw = item.raw as { bibcode: string; adsUrl: string; arxivUrl?: string; arxivClass?: string[] };
          return {
            bibcode: raw.bibcode,
            title: item.title,
            authors: item.author ? JSON.stringify([item.author]) : undefined,
            pubdate: item.publishedAt.toISOString().split('T')[0], // YYYY-MM-DD format
            abstract: item.summary || item.contentSnippet || undefined,
            body: item.fullText || undefined, // Full text from ADS
            year: item.publishedAt.getFullYear(),
            journal: 'arXiv', // Most will be from arXiv
            adsUrl: raw.adsUrl,
            arxivUrl: raw.arxivUrl || null,
            fulltextSource: item.fullText ? 'ads_api' : undefined,
          };
        });

        await storePapersBatch(papersToStore);

        // Score items
        const scoreResult = await computeAndSaveScoresForItems(researchItems);

        totalItemsAdded += researchItems.length;
        totalItemsScored += scoreResult.totalScored;

        logger.info(`[ADS-RESEARCH] Processed ${researchItems.length} items for ${currentYear}-${String(currentMonth).padStart(2, '0')} (total added: ${totalItemsAdded}, total scored: ${totalItemsScored})`);
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`[ADS-RESEARCH] Failed to fetch ${currentYear}-${String(currentMonth).padStart(2, '0')}, continuing...`, error);
      // Continue with next month even if this one fails
    }

    // Move to next month
    currentMonth = nextMonth;
    currentYear = nextYear;
  }

  if (totalFound === 0) {
    logger.info(`[ADS-RESEARCH] No papers found for last ${yearsBack} years`);
    return { itemsAdded: 0, itemsScored: 0, totalFound: 0 };
  }

  logger.info(
    `[ADS-RESEARCH] Initial backfill complete: ${totalItemsAdded} items added, ${totalItemsScored} scored, ${totalFound} total papers found`
  );

  return {
    itemsAdded: totalItemsAdded,
    itemsScored: totalItemsScored,
    totalFound,
  };
}

