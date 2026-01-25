#!/usr/bin/env tsx
/**
 * Test ADS research query syntax
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function testQuery() {
  const token = process.env.ADS_API_TOKEN;

  if (!token) {
    console.error('❌ ADS_API_TOKEN not set');
    process.exit(1);
  }

  // Test the query building
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const startDate = `${year}-${String(month).padStart(2, '0')}`;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

  const pubdateQuery = `pubdate:[${startDate} TO ${endDate}]`;
  const absQuery = `abs:(code OR coding OR software OR developer) AND abs:(agent OR agentic OR SDLC OR enterprise OR "code search" OR context OR "information retrieval")`;
  const arxivClasses = [
    'cs.SE', 'cs.IR', 'cs.SY', 'cs.DS', 'cs.CL', 'cs.IT', 'cs.DB',
    'cs.MA', 'cs.AI', 'cs.DC', 'cs.DL', 'cs.GL', 'cs.LG'
  ];
  const arxivQuery = arxivClasses.map(c => `arxiv_class:${c}`).join(' OR ');

  const fullQuery = `${pubdateQuery} AND (${absQuery}) AND (${arxivQuery})`;

  console.log('📋 Testing ADS Research Query');
  console.log('='.repeat(60));
  console.log('Query:', fullQuery);
  console.log('');

  // Test the query
  const params = new URLSearchParams({
    q: fullQuery,
    fl: 'bibcode,title,author,pubdate,abstract,body,arxiv_class',
    sort: 'score desc',
    rows: '10',
    start: '0',
  });

  const url = `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`;
  console.log('URL:', url.substring(0, 100) + '...');
  console.log('');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', response.status, response.statusText);
      console.error('Response:', errorText);
      process.exit(1);
    }

    const data = await response.json() as {
      response?: {
        numFound?: number;
        docs?: Array<{
          bibcode: string;
          title?: string[];
          author?: string[];
          pubdate?: string;
          abstract?: string;
          body?: string | string[];
          arxiv_class?: string[];
        }>;
      };
    };

    console.log('✅ Query successful!');
    console.log('Total found:', data.response?.numFound || 0);
    console.log('Results returned:', data.response?.docs?.length || 0);
    console.log('');

    if (data.response?.docs && data.response.docs.length > 0) {
      console.log('First result:');
      const first = data.response.docs[0];
      console.log('  Bibcode:', first.bibcode);
      console.log('  Title:', first.title?.[0] || 'N/A');
      console.log('  Pubdate:', first.pubdate || 'N/A');
      console.log('  Has body:', !!first.body);
      console.log('  Arxiv class:', first.arxiv_class?.join(', ') || 'N/A');
      console.log('');

      if (data.response.docs.length > 1) {
        console.log(`... and ${data.response.docs.length - 1} more results`);
      }
    } else {
      console.log('⚠️  No results found for current month');
      console.log('This might be normal if there are no papers matching the criteria this month');
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

testQuery().catch(console.error);

