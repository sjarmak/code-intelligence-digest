/**
 * Check what ADS API returns for the body field
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env.local
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const bibcode = '2025arXiv251204123P';
const token = process.env.ADS_API_TOKEN;

if (!token) {
  console.error('❌ ADS_API_TOKEN not found in .env.local');
  process.exit(1);
}

async function checkADSBody() {
  try {
    const query = `bibcode:"${bibcode}"`;
    const fields = 'bibcode,title,author,pubdate,abstract,body';

    const params = new URLSearchParams({
      q: query,
      rows: '1',
      fl: fields,
    });

    console.log('🔍 Querying ADS API...');
    console.log('Query:', query);
    console.log('Fields:', fields);
    console.log('');

    const response = await fetch(
      `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ADS API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.response?.docs || data.response.docs.length === 0) {
      console.log('❌ No documents found');
      return;
    }

    const doc = data.response.docs[0];

    console.log('✅ Paper found in ADS');
    console.log('Bibcode:', doc.bibcode);
    console.log('Title:', doc.title?.[0]);
    console.log('');

    console.log('📄 Body field analysis:');
    console.log('  - Has body field:', 'body' in doc);
    console.log('  - Body type:', typeof doc.body);
    console.log('  - Is array:', Array.isArray(doc.body));

    if (Array.isArray(doc.body)) {
      console.log('  - Array length:', doc.body.length);
      if (doc.body.length > 0) {
        console.log('  - First element type:', typeof doc.body[0]);
        console.log('  - First element length:', doc.body[0]?.length || 0);
        console.log('  - First 500 chars:', doc.body[0]?.substring(0, 500) || 'empty');
        console.log('  - Last 200 chars:', doc.body[0]?.substring(Math.max(0, (doc.body[0]?.length || 0) - 200)) || 'empty');
      }
    } else if (doc.body) {
      console.log('  - Body length:', doc.body.length);
      console.log('  - First 500 chars:', doc.body.substring(0, 500));
      console.log('  - Last 200 chars:', doc.body.substring(Math.max(0, doc.body.length - 200)));
    } else {
      console.log('  - Body is null/undefined');
    }

    console.log('');
    console.log('📋 Full body field (JSON):');
    console.log(JSON.stringify(doc.body, null, 2));

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

checkADSBody();

