import { NextResponse } from "next/server";
import { createInoreaderClient } from "@/src/lib/inoreader/client";
import { logger } from "@/src/lib/logger";
import * as fs from "fs";
import * as path from "path";

// Map folder names to categories
const FOLDER_TO_CATEGORY: Record<string, string> = {
  research: "research",
  "arxiv digest": "research",
  arxivdigest: "research",
  "tech articles": "tech_articles",
  "tech-articles": "tech_articles",
  "tech company blogs": "tech_articles",
  "developer communities": "community",
  "tech podcasts": "podcasts",
  "coding agent product updates": "product_news",
  "ai articles": "ai_news",
};

interface FeedConfig {
  streamId: string;
  canonicalName: string;
  defaultCategory: string;
  tags?: string[];
  vendor?: string;
}

function mapFolderToCategory(folderPath: string): string {
  const normalized = folderPath.toLowerCase();
  return FOLDER_TO_CATEGORY[normalized] || "newsletters";
}

export async function POST() {
  try {
    logger.info("Starting feed refresh...");

    const client = createInoreaderClient();
    const subscriptionList = await client.getSubscriptions();

    const feeds: FeedConfig[] = [];

    if (subscriptionList.subscriptions && Array.isArray(subscriptionList.subscriptions)) {
      for (const sub of subscriptionList.subscriptions) {
        const folderLabels: string[] = [];

        if (Array.isArray(sub.categories)) {
          for (const cat of sub.categories) {
            const labelStr = typeof cat === "string" ? cat : cat?.label;
            if (labelStr) {
              folderLabels.push(labelStr);
            }
          }
        }

        let category = "newsletters";
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
      }
    }

    // Save to cache
    const cacheDir = path.join(process.cwd(), ".cache");
    const feedsCacheFile = path.join(cacheDir, "feeds.json");

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    fs.writeFileSync(feedsCacheFile, JSON.stringify(feeds, null, 2));

    logger.info(`Refreshed and cached ${feeds.length} feeds`);

    return NextResponse.json({
      success: true,
      feedCount: feeds.length,
      message: "Feeds refreshed and cached",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Feed refresh failed", error);

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
