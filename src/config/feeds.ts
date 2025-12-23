/**
 * Feed configuration mapping Inoreader streamIds to categories
 * Dynamically fetches subscriptions and organizes them by folder/label
 */

import { Category } from "../lib/model";
import { createInoreaderClient } from "../lib/inoreader/client";
import { logger } from "../lib/logger";
import { initializeDatabase } from "../lib/db/index";
import {
  saveFeeds as saveFeedsDb,
  loadAllFeeds,
  isFeedsCacheValid,
  updateFeedsCacheMetadata,
} from "../lib/db/feeds";
import * as fs from "fs";
import * as path from "path";

export interface FeedConfig {
  streamId: string;
  canonicalName: string;
  defaultCategory: Category;
  tags?: string[];
  vendor?: string;
}

/**
 * Category mapping based on Inoreader folder/label names
 */
const FOLDER_TO_CATEGORY: Record<string, Category> = {
  // Research
  research: "research",
  "arxiv digest": "research",
  arxivdigest: "research",
  paper: "research",
  papers: "research",
  arxiv: "research",
  academic: "research",

  // Tech Articles / Blogs
  "tech articles": "tech_articles",
  "tech-articles": "tech_articles",
  articles: "tech_articles",
  blog: "tech_articles",
  blogs: "tech_articles",
  "dev-blogs": "tech_articles",
  "dev blogs": "tech_articles",
  engineering: "tech_articles",
  "engineering-blogs": "tech_articles",
  "tech company blogs": "tech_articles",

  // Podcasts
  podcast: "podcasts",
  podcasts: "podcasts",
  "tech podcasts": "podcasts",
  "dev-podcast": "podcasts",
  "ai podcast": "podcasts",

  // Product News / Updates
  "product news": "product_news",
  "product updates": "product_news",
  "coding agent product updates": "product_news",
  releases: "product_news",
  changelog: "product_news",
  announcements: "product_news",

  // Community
  "developer communities": "community",
  community: "community",
  reddit: "community",
  "hn": "community",
  "hacker news": "community",
  "news": "community",
  discussion: "community",

  // AI News / Articles
  "ai news": "ai_news",
  "ai-news": "ai_news",
  "ai articles": "ai_news",
  "ai-articles": "ai_news",
  "ai research": "ai_news",
  "ai-research": "ai_news",
  llm: "ai_news",
  "machine-learning": "ai_news",

  // Newsletters (fallback)
  newsletter: "newsletters",
  newsletters: "newsletters",
  "dev-news": "newsletters",
  "weekly-digest": "newsletters",
};

/**
 * Inoreader folder name patterns to match against folder hierarchy
 */
function mapFolderToCategory(folderPath: string): Category | null {
  const parts = folderPath.toLowerCase().split("/").filter(p => p.length > 0);
  
  for (const part of parts) {
    if (FOLDER_TO_CATEGORY[part]) {
      return FOLDER_TO_CATEGORY[part];
    }
  }

  // Default fallback
  return null;
}

let cachedFeeds: FeedConfig[] | null = null;

const FEEDS_CACHE_FILE = path.join(process.cwd(), ".cache", "feeds.json");

/**
 * Load feeds from disk cache
 */
function loadFeedsFromCache(): FeedConfig[] | null {
  try {
    if (fs.existsSync(FEEDS_CACHE_FILE)) {
      const content = fs.readFileSync(FEEDS_CACHE_FILE, "utf-8");
      const cached = JSON.parse(content);
      logger.info(`Loaded ${cached.length} feeds from disk cache`);
      return cached;
    }
  } catch (error) {
    logger.warn("Failed to load feeds from disk cache", { error });
  }
  return null;
}

/**
 * Save feeds to disk cache
 */
function saveFeedsToCache(feeds: FeedConfig[]): void {
  try {
    const cacheDir = path.dirname(FEEDS_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(FEEDS_CACHE_FILE, JSON.stringify(feeds, null, 2));
    logger.info(`Saved ${feeds.length} feeds to disk cache`);
  } catch (error) {
    logger.warn("Failed to save feeds to disk cache", { error });
  }
}

/**
 * Dynamically fetch all feeds from Inoreader
 * Organizes them by folder/label into categories
 * Uses database-backed cache with fallback to Inoreader API
 */
export async function getFeeds(): Promise<FeedConfig[]> {
  // Use in-memory cache if available
  if (cachedFeeds) {
    return cachedFeeds;
  }

  try {
    // Initialize database on first use
    await initializeDatabase();

    // Try to load from database cache first (much faster, avoids rate limits)
    const isCacheValid = await isFeedsCacheValid();
    if (isCacheValid) {
      const dbFeeds = await loadAllFeeds();
      if (dbFeeds && dbFeeds.length > 0) {
        logger.info(`[FEEDS] Loaded ${dbFeeds.length} feeds from database cache (cost: 0 API calls)`);
        cachedFeeds = dbFeeds;
        return dbFeeds;
      }
    }

    logger.info("[FEEDS] Database cache expired or empty, fetching from Inoreader API (cost: 1 API call)...");
    const client = createInoreaderClient();
    const subscriptionList = await client.getSubscriptions();

    const feeds: FeedConfig[] = [];

    if (subscriptionList.subscriptions && Array.isArray(subscriptionList.subscriptions)) {
      for (const sub of subscriptionList.subscriptions) {
        // Extract folder/label information from the subscription
        // Categories come as objects with { id: "user/.../label/...", label: "..." }
        const folderLabels: string[] = [];
        
        if (Array.isArray(sub.categories)) {
          for (const cat of sub.categories) {
            // cat can be a string (old format) or object with label property
            const labelStr = typeof cat === 'string' ? cat : cat?.label;
            if (labelStr) {
              folderLabels.push(labelStr);
            }
          }
        }

        let category: Category = "newsletters"; // default

        // Try to map folder to category
        for (const folderLabel of folderLabels) {
          const mapped = mapFolderToCategory(folderLabel);
          if (mapped) {
            category = mapped;
            break;
          }
        }

        feeds.push({
          streamId: sub.id,
          canonicalName: sub.title,
          defaultCategory: category,
          tags: folderLabels,
          vendor: sub.htmlUrl ? new URL(sub.htmlUrl).hostname : undefined,
        });

        logger.info(`Loaded feed: ${sub.title} → ${category}`);
      }
    }

    logger.info(`Loaded ${feeds.length} feeds from Inoreader`);
    cachedFeeds = feeds;
    
    // Save to database cache and update metadata
    await saveFeedsDb(feeds);
    await updateFeedsCacheMetadata(feeds.length);
    
    // Also keep disk cache in sync for backwards compatibility
    saveFeedsToCache(feeds);
    
    return feeds;
  } catch (error) {
    logger.error("Failed to fetch feeds from Inoreader", error);
    // Try to return cached feeds from database
    try {
      const dbFeeds = await loadAllFeeds();
      if (dbFeeds && dbFeeds.length > 0) {
        logger.warn("Returning feeds from database cache due to API fetch error");
        cachedFeeds = dbFeeds;
        return dbFeeds;
      }
    } catch (dbError) {
      logger.error("Also failed to load from database cache", dbError);
    }
    
    // Final fallback: try disk cache
    const staleDiskCache = loadFeedsFromCache();
    if (staleDiskCache && staleDiskCache.length > 0) {
      logger.warn("Returning stale feeds from disk cache as final fallback");
      cachedFeeds = staleDiskCache;
      return staleDiskCache;
    }
    
    logger.error("No feeds available - API error and no cache");
    return [];
  }
}

/**
 * Get feed config by stream ID
 */
export async function getFeedConfig(streamId: string): Promise<FeedConfig | undefined> {
  const feeds = await getFeeds();
  return feeds.find((f) => f.streamId === streamId);
}

/**
 * Get all streams for a given category
 */
export async function getStreamsByCategory(category: Category): Promise<string[]> {
  const feeds = await getFeeds();
  return feeds.filter((f) => f.defaultCategory === category).map((f) => f.streamId);
}

/**
 * Legacy static FEEDS array for reference/fallback
 * Replace with dynamic getFeeds() in production
 */
export const FEEDS: FeedConfig[] = [
  // Example feeds - will be replaced by dynamic discovery
  {
    streamId: "feed/https://pragmaticengineer.com/feed/",
    canonicalName: "Pragmatic Engineer",
    defaultCategory: "newsletters",
    tags: ["eng-leadership", "devex"],
  },
];
