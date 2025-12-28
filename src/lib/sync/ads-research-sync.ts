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
 * @param year Current year
 * @param month Current month (1-12)
 */
function buildResearchQuery(year: number, month: number): string {
  // Calculate next month for date range
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  
  // Format dates: YYYY-MM
  const startDate = `${year}-${String(month).padStart(2, '0')}`;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  
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
 * Fetch research papers from ADS Search API
 */
async function fetchResearchPapers(
  token: string,
  year: number,
  month: number
): Promise<ADSSearchResponse['response']['docs']> {
  const query = buildResearchQuery(year, month);
  
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
    
    // Limit to reasonable number (e.g., 10,000 papers max)
    if (allDocs.length >= 10000) {
      logger.warn('[ADS-RESEARCH] Reached 10,000 paper limit, stopping fetch');
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
  let publishedAt = new Date();
  if (doc.pubdate) {
    // pubdate format: "2025-12" or "2025-12-15"
    const dateMatch = doc.pubdate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      publishedAt = new Date(
        parseInt(year, 10),
        parseInt(month, 10) - 1,
        day ? parseInt(day, 10) : 1
      );
    }
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
 * Sync research papers from ADS Search API
 * 
 * @param token ADS API token
 * @returns Number of items added
 */
export async function syncResearchFromADS(token: string): Promise<{
  itemsAdded: number;
  itemsScored: number;
  totalFound: number;
}> {
  logger.info('[ADS-RESEARCH] Starting research sync from ADS');
  
  // Get current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  
  // Fetch papers from ADS
  const docs = await fetchResearchPapers(token, year, month);
  
  if (docs.length === 0) {
    logger.info('[ADS-RESEARCH] No papers found for current month');
    return { itemsAdded: 0, itemsScored: 0, totalFound: 0 };
  }
  
  // Convert to FeedItems
  const feedItems = docs.map(adsPaperToFeedItem);
  
  logger.info(`[ADS-RESEARCH] Converted ${feedItems.length} papers to FeedItems`);
  
  // Note: normalizeItems expects InoreaderArticle[], but we have FeedItem[]
  // For ADS papers, we've already normalized them (URLs, dates, etc. are set)
  // So we can skip normalization and go straight to categorization
  // Categorize (should all be 'research' already, but ensure)
  const categorizedItems = await categorizeItems(feedItems);
  
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

