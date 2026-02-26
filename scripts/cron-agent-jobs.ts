#!/usr/bin/env tsx
/**
 * Cron script: run GTM/marketing agent jobs.
 * - Daily jobs: run every time this script runs (schedule via Render cron, e.g. once per day).
 * - Weekly jobs: run only on Mondays (configurable).
 *
 * Usage:
 *   npm run cron:agents
 *   npx tsx scripts/cron-agent-jobs.ts
 *
 * Environment: DATABASE_URL (or LOCAL_DATABASE_URL). LLM: ANTHROPIC_API_KEY or OPENAI_API_KEY (see quality model in AGENTS.md). Optional: PARALLEL_API_KEY for web search on jobs with webSearchQueries.
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { initializeDatabase } from "../src/lib/db/index";
import { getJobsForSchedule } from "../src/config/agent-jobs";
import { runAgentJob } from "../src/lib/agents/run-job";
import { logger } from "../src/lib/logger";

const WEEKLY_JOBS_DAY = 1; // Monday = 1 (0 = Sunday)

async function main(): Promise<void> {
  logger.info("Starting agent jobs cron...");

  await initializeDatabase();

  const dailyJobs = getJobsForSchedule("daily");
  const weeklyJobs = getJobsForSchedule("weekly");
  const now = new Date();
  const isWeeklyDay = now.getDay() === WEEKLY_JOBS_DAY;
  const jobsToRun = [
    ...dailyJobs,
    ...(isWeeklyDay ? weeklyJobs : []),
  ];

  if (jobsToRun.length === 0) {
    logger.info("No jobs scheduled for this run.");
    return;
  }

  logger.info(`Running ${jobsToRun.length} jobs (daily: ${dailyJobs.length}, weekly: ${isWeeklyDay ? weeklyJobs.length : 0})`);

  let ok = 0;
  let fail = 0;
  for (const job of jobsToRun) {
    try {
      const result = await runAgentJob(job.agentId, job.jobId);
      if (result) {
        ok++;
        logger.info(`  ${job.agentId}/${job.jobId} -> ${result.runId}`);
      } else {
        fail++;
      }
    } catch (err) {
      fail++;
      logger.error(`  ${job.agentId}/${job.jobId} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(`Agent jobs finished: ${ok} ok, ${fail} failed`);
}

main().catch((err) => {
  logger.error("Agent jobs cron error", err);
  process.exit(1);
});
