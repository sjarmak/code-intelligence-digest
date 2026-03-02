#!/usr/bin/env node
/**
 * Test 30d and 90d report generation
 */

import("../dist/src/lib/agents/content-ideas.js")
  .then(async (module) => {
    const { generateContentIdeas } = module;
    
    console.log("\n🔍 Testing 30-day Content Ideas\n");
    
    const ideas = await generateContentIdeas({
      periodDays: 30,
      debug: true,
    });
    
    console.log(`\nResult: ${ideas.ideas.length} ideas generated`);
    console.log("\nTop ideas:");
    for (const idea of ideas.ideas.slice(0, 3)) {
      console.log(`\n  📌 ${idea.title}`);
      console.log(`     Persona: ${idea.target_persona}`);
      console.log(`     Channel: ${idea.channel}`);
      if (idea.sources[0]) {
        console.log(`     Source: ${idea.sources[0].source}`);
      }
    }
  })
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
