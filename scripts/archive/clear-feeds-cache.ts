#!/usr/bin/env npx tsx
/**
 * Clear the feeds cache from the database
 * Re-fetches from Inoreader on next API call with correct category mappings
 */

import { initializeDatabase } from "@/src/lib/db/index";
import { deleteFeedsCache } from "@/src/lib/db/feeds";

async function main() {
  try {
    console.log("Initializing database...");
    await initializeDatabase();
    
    console.log("Clearing feeds cache...");
    await deleteFeedsCache();
    
    console.log("✓ Feeds cache cleared successfully");
    console.log("Next sync will re-fetch from Inoreader with correct category mappings.");
    console.log("Tech Leaders folder will now map to Community (not Newsletters).");
  } catch (error) {
    console.error("✗ Failed to clear feeds cache:", error);
    process.exit(1);
  }
}

main();
