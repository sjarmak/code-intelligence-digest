/**
 * Test what happens with current quota and sync threshold
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from "../src/lib/db/index";
import { getGlobalApiBudget } from "../src/lib/db/index";

async function main() {
  await initializeDatabase();

  console.log('=== Sync Threshold Check ===\n');

  const budget = await getGlobalApiBudget();
  console.log(`Current Budget:`);
  console.log(`  Calls Used: ${budget.callsUsed}/${budget.quotaLimit}`);
  console.log(`  Remaining: ${budget.remaining}`);
  console.log(`  Percent: ${Math.round((budget.callsUsed / budget.quotaLimit) * 100)}%\n`);

  // Calculate pause threshold
  const PAUSE_THRESHOLD = Math.max(50, Math.floor(budget.quotaLimit * 0.05));
  console.log(`Pause Threshold: ${PAUSE_THRESHOLD} calls remaining (5% of quota)\n`);

  if (budget.remaining <= PAUSE_THRESHOLD) {
    console.log(`❌ SYNC WOULD PAUSE IMMEDIATELY`);
    console.log(`   Remaining (${budget.remaining}) <= Threshold (${PAUSE_THRESHOLD})`);
    console.log(`   Sync would return early without fetching any items\n`);
  } else {
    console.log(`✅ Sync would proceed (${budget.remaining} > ${PAUSE_THRESHOLD})\n`);
  }

  console.log(`To allow syncs to run, you need at least ${PAUSE_THRESHOLD + 1} calls remaining.`);
  console.log(`Currently need: ${PAUSE_THRESHOLD + 1 - budget.remaining} more calls until quota resets.\n`);
}

main().catch(console.error);

