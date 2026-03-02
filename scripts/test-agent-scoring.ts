#!/usr/bin/env npx tsx
/**
 * Test script to run market brief and content ideas with debug logging.
 * Usage: npm run script -- test-agent-scoring [--period 30] [--goal market_brief|content_ideas]
 */

import { generateMarketBrief } from "../src/lib/agents/market-brief";
import { generateContentIdeas } from "../src/lib/agents/content-ideas";

async function main() {
  try {
    const args = process.argv.slice(2);
    const periodArg = args.find((a) => a.startsWith("--period"));
    const periodDays = periodArg ? parseInt(periodArg.split("=")[1] || "30") : 30;
    const goalArg = args.find((a) => a.startsWith("--goal"));
    const goal = goalArg ? goalArg.split("=")[1] : "both";

    console.log(`\n📊 Testing agent scoring with periodDays=${periodDays}`);

    if (goal === "market_brief" || goal === "both") {
      console.log("\n🎯 Running Market Brief...");
      try {
        const marketBrief = await generateMarketBrief({
          periodDays,
          debug: true,
        });
        console.log(`✅ Market Brief generated:`);
        console.log(`   Executive Delta: ${marketBrief.executive_delta.length} items`);
        console.log(`   Watch Items: ${marketBrief.watch_items.length} items`);
        if (marketBrief.executive_delta.length > 0) {
          console.log(`   Sample types:`, marketBrief.executive_delta.map((d) => d.title).slice(0, 3));
        }
      } catch (err) {
        console.error("Market Brief error:", err);
      }
    }

    if (goal === "content_ideas" || goal === "both") {
      console.log("\n💡 Running Content Ideas...");
      try {
        const contentIdeas = await generateContentIdeas({
          periodDays,
          debug: true,
        });
        console.log(`✅ Content Ideas generated:`);
        console.log(`   Total Ideas: ${contentIdeas.ideas.length}`);
        const domains = new Set(contentIdeas.ideas.map((i) => i.sources[0]?.source || "unknown"));
        console.log(`   Distinct Domains: ${domains.size}`);
        console.log(`   Domains:`, Array.from(domains).slice(0, 5).join(", "));
      } catch (err) {
        console.error("Content Ideas error:", err);
      }
    }

    console.log("\n✅ Debug logs written to .data/agent-debug/");
    console.log("📁 Check: ls .data/agent-debug/");
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
