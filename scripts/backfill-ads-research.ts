#!/usr/bin/env tsx
/**
 * Initial backfill script for ADS research papers
 * 
 * Fetches all research papers from the last 3 years and stores them in the database.
 * This should be run once to populate the database with historical papers.
 * 
 * After this initial backfill, the hourly cron job will use syncResearchFromADS
 * which uses a sliding month window to catch new papers.
 * 
 * Usage:
 *   npx tsx scripts/backfill-ads-research.ts [--years=3]
 * 
 * Options:
 *   --years=N: Number of years to go back (default: 3)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { syncResearchFromADSInitial } from '../src/lib/sync/ads-research-sync';
import { logger } from '../src/lib/logger';

async function main() {
  const args = process.argv.slice(2);
  const yearsArg = args.find(arg => arg.startsWith('--years='));
  const yearsBack = yearsArg ? parseInt(yearsArg.split('=')[1], 10) : 3;
  
  if (isNaN(yearsBack) || yearsBack < 1 || yearsBack > 10) {
    console.error('Error: --years must be between 1 and 10');
    process.exit(1);
  }
  
  const token = process.env.ADS_API_TOKEN;
  if (!token) {
    console.error('Error: ADS_API_TOKEN environment variable not set');
    process.exit(1);
  }
  
  console.log(`\n📚 Starting ADS Research Initial Backfill`);
  console.log(`   Fetching papers from last ${yearsBack} years...`);
  console.log(`   This may take a while depending on the number of papers.\n`);
  
  try {
    await initializeDatabase();
    
    const result = await syncResearchFromADSInitial(token, yearsBack);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Backfill Complete');
    console.log('='.repeat(60));
    console.log(`Total papers found:  ${result.totalFound}`);
    console.log(`Items added:         ${result.itemsAdded}`);
    console.log(`Items scored:        ${result.itemsScored}`);
    console.log('='.repeat(60) + '\n');
    
    console.log('💡 After this initial backfill, the hourly cron job will');
    console.log('   automatically sync new papers using a sliding month window.\n');
  } catch (error) {
    logger.error('Backfill failed', error);
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in backfill script', error);
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

