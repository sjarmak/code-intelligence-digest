#!/usr/bin/env tsx
/**
 * Initialize local PostgreSQL database with schema
 * 
 * This script ensures the local PostgreSQL database has the correct schema
 * before syncing data or running the app.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { logger } from '../src/lib/logger';

async function initLocalPostgres() {
  logger.info('Initializing local PostgreSQL database...');

  // Check if LOCAL_DATABASE_URL is set
  const localUrl = process.env.LOCAL_DATABASE_URL;
  if (!localUrl || !localUrl.startsWith('postgres')) {
    throw new Error('LOCAL_DATABASE_URL must be set to local Postgres connection string');
  }

  logger.info('Using LOCAL_DATABASE_URL for initialization');

  // Set flag to use local database
  process.env.USE_LOCAL_DB = 'true';

  try {
    // Initialize database (this will create tables if they don't exist)
    await initializeDatabase();
    logger.info('✅ Local PostgreSQL database initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize local PostgreSQL', { error });
    throw error;
  } finally {
    // Clear flag
    delete process.env.USE_LOCAL_DB;
  }
}

initLocalPostgres()
  .then(() => {
    logger.info('Initialization complete');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Initialization failed', { error });
    process.exit(1);
  });

