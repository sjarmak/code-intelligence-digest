import { NextResponse } from "next/server";
import { createInoreaderClient } from "@/src/lib/inoreader/client";
import { logger } from "@/src/lib/logger";

export async function GET() {
  try {
    logger.info("DEBUG: Creating Inoreader client...");
    const client = createInoreaderClient();
    
    logger.info("DEBUG: Fetching subscriptions...");
    const subscriptions = await client.getSubscriptions();
    
    const subscriptionArray = subscriptions.subscriptions as unknown[];
    logger.info(`DEBUG: Got response with ${Array.isArray(subscriptionArray) ? subscriptionArray.length : 0} subscriptions`);
    
    return NextResponse.json({
      success: true,
      subscriptionCount: Array.isArray(subscriptionArray) ? subscriptionArray.length : 0,
      rawResponse: subscriptions,
    }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("DEBUG: Error fetching subscriptions", error);
    
    return NextResponse.json(
      { 
        error: message,
        errorDetails: error instanceof Error ? {
          message: error.message,
          stack: error.stack?.split('\n').slice(0, 5),
        } : null,
      },
      { status: 500 }
    );
  }
}
