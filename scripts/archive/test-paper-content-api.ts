/**
 * Direct API test to investigate why papers show abstract-only
 * Tests the paper content API endpoint directly without Playwright
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3002';
const UI_PASSWORD = process.env.UI_PASSWORD;

async function authenticate(): Promise<string | null> {
  if (!UI_PASSWORD) {
    console.warn('⚠️  UI_PASSWORD not set, authentication may fail');
    return null;
  }

  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: UI_PASSWORD }),
    });

    if (response.ok) {
      // Extract cookie from Set-Cookie header
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const match = setCookie.match(/ui-auth=([^;]+)/);
        if (match) {
          return match[1];
        }
      }
    }
  } catch (error) {
    console.warn('⚠️  Authentication failed:', error instanceof Error ? error.message : String(error));
  }

  return null;
}

interface PaperContentResponse {
  source: 'ar5iv' | 'ads' | 'abstract' | 'cached';
  html: string;
  title?: string;
  authors?: string[];
  abstract?: string;
  sections?: Array<{ id: string; title: string; level: number }>;
  figures?: Array<{ id: string; src: string; caption: string }>;
  bibcode: string;
  arxivId?: string | null;
  adsUrl?: string;
  arxivUrl?: string | null;
  error?: string;
}

async function testPaperContent(bibcode: string) {
  console.log(`\n=== Testing Paper Content API ===`);
  console.log(`Bibcode: ${bibcode}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('');

  // Authenticate first
  console.log('Authenticating...');
  const authCookie = await authenticate();
  if (authCookie) {
    console.log('✅ Authentication successful');
  } else {
    console.log('⚠️  Authentication failed or skipped');
  }
  console.log('');

  try {
    // Encode bibcode for URL
    const encodedBibcode = encodeURIComponent(bibcode);
    const url = `${BASE_URL}/api/papers/${encodedBibcode}/content`;

    console.log(`Request URL: ${url}`);
    console.log(`Encoded bibcode: ${encodedBibcode}`);
    console.log('');

    const headers: HeadersInit = {
      'Accept': 'application/json',
    };

    // Add auth cookie if we have it
    if (authCookie) {
      headers['Cookie'] = `ui-auth=${authCookie}`;
    }

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    const duration = Date.now() - startTime;
    console.log(`Response Status: ${response.status} ${response.statusText}`);
    console.log(`Response Time: ${duration}ms`);
    console.log('');

    // Check content type
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!isJson) {
      const text = await response.text();
      console.error(`❌ Response is not JSON (status: ${response.status})`);
      console.error(`Content-Type: ${contentType}`);
      console.error(`Response preview: ${text.substring(0, 500)}`);

      if (text.includes('login') || text.includes('Login')) {
        console.error('\n⚠️  This appears to be a login page. The API may require authentication.');
        console.error('   Make sure you are logged in or check the authentication setup.');
      }
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API Error: ${response.status}`);
      try {
        const errorData = JSON.parse(errorText);
        console.error(`Error: ${errorData.error || errorText}`);
      } catch {
        console.error(`Response: ${errorText.substring(0, 500)}`);
      }
      return;
    }

    const data: PaperContentResponse = await response.json();

    console.log('=== Response Analysis ===');
    console.log(`Source: ${data.source}`);
    console.log(`Has HTML: ${!!data.html}`);
    console.log(`HTML Length: ${data.html?.length || 0} characters`);
    console.log(`Has Title: ${!!data.title}`);
    console.log(`Has Abstract: ${!!data.abstract}`);
    console.log(`Has Sections: ${!!data.sections && data.sections.length > 0}`);
    console.log(`Sections Count: ${data.sections?.length || 0}`);
    console.log(`Has Figures: ${!!data.figures && data.figures.length > 0}`);
    console.log(`Figures Count: ${data.figures?.length || 0}`);
    console.log(`Arxiv ID: ${data.arxivId || 'N/A'}`);
    console.log(`Arxiv URL: ${data.arxivUrl || 'N/A'}`);
    console.log(`ADS URL: ${data.adsUrl || 'N/A'}`);
    console.log('');

    if (data.error) {
      console.error(`❌ Error in response: ${data.error}`);
      console.log('');
    }

    // Analyze the issue
    if (data.source === 'abstract') {
      console.log('❌ ISSUE: Paper is showing abstract-only!');
      console.log('');
      console.log('Possible reasons:');
      console.log('  1. ar5iv fetch failed (check if arxivId is valid)');
      console.log(`     Arxiv ID: ${data.arxivId || 'NOT FOUND'}`);
      if (data.arxivId) {
        const ar5ivUrl = `https://ar5iv.org/html/${data.arxivId}`;
        console.log(`     ar5iv URL: ${ar5ivUrl}`);
      }
      console.log('  2. ADS API did not return body field');
      console.log('  3. Paper is not an arXiv paper (no arxivId)');
      console.log('');
      console.log('HTML Preview (first 300 chars):');
      console.log(data.html?.substring(0, 300) || 'No HTML');
      console.log('');
    } else if (data.source === 'ar5iv') {
      console.log('✅ SUCCESS: Paper content from ar5iv');
      console.log(`   HTML length: ${data.html.length} characters`);
      if (data.sections && data.sections.length > 0) {
        console.log(`   Sections: ${data.sections.length}`);
        console.log('   First 3 sections:');
        data.sections.slice(0, 3).forEach((section, i) => {
          console.log(`     ${i + 1}. ${section.title} (level ${section.level})`);
        });
      }
    } else if (data.source === 'ads') {
      console.log('✅ SUCCESS: Paper content from ADS API');
      console.log(`   HTML length: ${data.html.length} characters`);
    } else if (data.source === 'cached') {
      console.log('✅ SUCCESS: Paper content from cache');
      console.log(`   HTML length: ${data.html.length} characters`);
    }

    // Check HTML content quality
    if (data.html) {
      const htmlLower = data.html.toLowerCase();
      const hasAbstractOnly = htmlLower.includes('abstract') &&
                             htmlLower.includes('full text is not available');
      const hasMinimalContent = data.html.length < 1000;
      const hasNoSections = !data.sections || data.sections.length === 0;

      console.log('');
      console.log('=== HTML Content Analysis ===');
      console.log(`HTML preview (first 500 chars):`);
      console.log(data.html.substring(0, 500));
      console.log('');
      console.log(`HTML preview (last 500 chars):`);
      console.log(data.html.substring(Math.max(0, data.html.length - 500)));
      console.log('');

      // Check for specific markers
      const hasAr5ivMarkers = htmlLower.includes('ltx_') || htmlLower.includes('paper-reader-content');
      const hasAdsMarkers = htmlLower.includes('paper-reader-ads');
      const hasAbstractMarkers = htmlLower.includes('paper-reader-abstract-only');

      console.log('Content markers:');
      console.log(`  - ar5iv markers: ${hasAr5ivMarkers}`);
      console.log(`  - ADS markers: ${hasAdsMarkers}`);
      console.log(`  - Abstract-only markers: ${hasAbstractMarkers}`);
      console.log('');

      if (hasAbstractOnly || (hasMinimalContent && hasNoSections)) {
        console.log('');
        console.log('⚠️  WARNING: HTML content appears to be abstract-only');
        if (hasAbstractOnly) {
          console.log('   - Contains "full text is not available" message');
        }
        if (hasMinimalContent) {
          console.log(`   - HTML is very short (${data.html.length} chars)`);
        }
        if (hasNoSections) {
          console.log('   - No sections found in content');
        }
      } else if (data.html.length > 10000 && hasNoSections) {
        console.log('');
        console.log('⚠️  WARNING: Large HTML content but no sections parsed');
        console.log('   This might indicate a parsing issue');
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error(`   Error message: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    }
  }
}

async function main() {
  // Get bibcode from command line or use a test one
  const bibcode = process.argv[2];

  if (!bibcode) {
    console.error('Usage: npx tsx scripts/test-paper-content-api.ts <bibcode>');
    console.error('');
    console.error('Example:');
    console.error('  npx tsx scripts/test-paper-content-api.ts 2025arXiv251212730D');
    console.error('');
    console.error('Or test with a bibcode from your libraries:');
    console.error('  1. Get a bibcode from /api/libraries?library=Benchmarks');
    console.error('  2. Run: npx tsx scripts/test-paper-content-api.ts <bibcode>');
    process.exit(1);
  }

  await testPaperContent(bibcode);
}

main().catch(console.error);

