import { NextResponse } from "next/server";
import { getFeeds } from "@/src/config/feeds";
import { logger } from "@/src/lib/logger";

export async function GET() {
  try {
    logger.info("DEBUG: Fetching feeds...");
    const feeds = await getFeeds();
    
    return NextResponse.json({
      success: true,
      feedCount: feeds.length,
      feeds: feeds.map(f => ({
        streamId: f.streamId,
        canonicalName: f.canonicalName,
        defaultCategory: f.defaultCategory,
      })),
    });
  } catch (error) {
    logger.error("DEBUG: Error fetching feeds", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
