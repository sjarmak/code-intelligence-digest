#!/usr/bin/env npx tsx
/**
 * Quick validation: run 30d and 90d reports and analyze results
 */

import { generateMarketBrief } from "../src/lib/agents/market-brief";
import { generateContentIdeas } from "../src/lib/agents/content-ideas";

async function run() {
  const periods = [30, 90];
  
  for (const days of periods) {
    const period = days === 30 ? "30d" : "90d";
    console.log(`\n${"=".repeat(70)}`);
    console.log(`📊 ${period.toUpperCase()} VALIDATION`);
    console.log(`${"=".repeat(70)}\n`);
    
    // Market Brief
    console.log("1️⃣  Market Brief:");
    try {
      const brief = await generateMarketBrief({
        periodDays: days,
        debug: true,
      });
      const execCount = brief.executive_delta.length;
      const watchCount = brief.watch_items.length;
      const themesCount = brief.landscape_themes?.length || 0;
      
      console.log(`   ✅ Exec Delta: ${execCount} items`);
      console.log(`   ✅ Watch Items: ${watchCount} items`);
      console.log(`   ✅ Landscape Themes: ${themesCount} sections`);
      
      if (execCount > 0) {
        console.log(`   Types: ${brief.executive_delta.map((d) => d.playbook_alignment[0] || "other").join(", ")}`);
      }
    } catch (err) {
      console.error(`   ❌ Error:`, (err as Error).message);
    }
    
    // Content Ideas
    console.log("\n2️⃣  Content Ideas:");
    try {
      const ideas = await generateContentIdeas({
        periodDays: days,
        debug: true,
      });
      const ideasCount = ideas.ideas.length;
      const domains = new Set<string>();
      const channels = new Set<string>();
      
      for (const idea of ideas.ideas) {
        if (idea.sources[0]?.source) domains.add(idea.sources[0].source);
        channels.add(idea.channel);
      }
      
      console.log(`   ✅ Ideas: ${ideasCount}`);
      console.log(`   ✅ Domains: ${domains.size} (${Array.from(domains).slice(0, 5).join(", ")}${domains.size > 5 ? "..." : ""})`);
      console.log(`   ✅ Channels: ${Array.from(channels).join(", ")}`);
    } catch (err) {
      console.error(`   ❌ Error:`, (err as Error).message);
    }
  }
  
  console.log(`\n\n✅ Validation complete!\n`);
}

run().catch(console.error);
