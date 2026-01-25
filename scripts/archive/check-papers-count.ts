import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { detectDriver, getDbClient } from '../src/lib/db/driver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function check() {
  const driver = detectDriver();
  console.log('Driver:', driver);
  const client = await getDbClient();

  const total = await client.query('SELECT COUNT(*) as total FROM ads_papers');
  console.log('Total papers:', total.rows[0]?.total || 0);

  const withBody = await client.query('SELECT COUNT(*) as total FROM ads_papers WHERE body IS NOT NULL AND LENGTH(body) >= 100');
  console.log('Papers with body >= 100:', withBody.rows[0]?.total || 0);

  const sample = await client.query('SELECT bibcode, LENGTH(body) as body_len FROM ads_papers WHERE body IS NOT NULL LIMIT 5');
  console.log('Sample papers:', sample.rows);
}

check().catch(console.error);

