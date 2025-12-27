/**
 * Use Playwright to investigate why papers are showing abstract-only
 * when full text should be available
 */

import { chromium } from 'playwright';
import { setTimeout } from 'timers/promises';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface APIRequest {
  url: string;
  method: string;
  requestBody?: any;
  response?: {
    status: number;
    statusText: string;
    body?: any;
    headers?: Record<string, string>;
  };
  timestamp: number;
}

async function investigate() {
  console.log('=== PLAYWRIGHT PAPER CONTENT INVESTIGATION ===');
  console.log('');

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3002';
  const uiPassword = process.env.UI_PASSWORD;

  if (!uiPassword) {
    console.error('❌ UI_PASSWORD not found in .env.local');
    process.exit(1);
  }

  console.log(`Navigating to: ${baseUrl}`);
  console.log('⚠️  Make sure the dev server is running: npm run dev');
  console.log('');

  const browser = await chromium.launch({
    headless: false, // Show browser for debugging
    slowMo: 500, // Slow down actions to see what's happening
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture all API requests and responses
  const apiRequests: APIRequest[] = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/papers/') || url.includes('/api/libraries')) {
      const apiReq: APIRequest = {
        url,
        method: request.method(),
        timestamp: Date.now(),
      };

      // Try to capture request body if it's a POST/PATCH
      if (['POST', 'PATCH', 'PUT'].includes(request.method())) {
        const postData = request.postData();
        if (postData) {
          try {
            apiReq.requestBody = JSON.parse(postData);
          } catch {
            apiReq.requestBody = postData;
          }
        }
      }

      apiRequests.push(apiReq);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/papers/') || url.includes('/api/libraries')) {
      const apiReq = apiRequests.find((req) => req.url === url && !req.response);
      if (apiReq) {
        try {
          const body = await response.json();
          apiReq.response = {
            status: response.status(),
            statusText: response.statusText(),
            body,
            headers: response.headers(),
          };
        } catch (e) {
          // Not JSON or failed to parse
          const text = await response.text().catch(() => 'Unable to read response');
          apiReq.response = {
            status: response.status(),
            statusText: response.statusText(),
            body: text.substring(0, 500),
            headers: response.headers(),
          };
        }
      }
    }
  });

  // Capture console logs and errors
  const consoleLogs: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    } else {
      consoleLogs.push(`[${msg.type()}] ${text}`);
    }
  });

  try {
    // Step 1: Navigate and login
    console.log('1. Navigating to homepage and logging in...');
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 10000 });
    await setTimeout(1000);

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.log('   Login required - auto-logging in...');
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await page.fill('input[type="password"]', uiPassword);
      await setTimeout(500);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
      await setTimeout(1000);
      console.log('   ✅ Logged in successfully');
    }

    // Step 2: Navigate to libraries page
    console.log('');
    console.log('2. Navigating to libraries page...');
    await page.goto(`${baseUrl}/libraries`, { waitUntil: 'networkidle', timeout: 10000 });
    await setTimeout(2000);

    // Step 3: Wait for libraries to load and find a paper
    console.log('');
    console.log('3. Waiting for libraries to load...');

    // Wait for library items to appear
    try {
      await page.waitForSelector('button, a', { timeout: 10000 });
    } catch {
      console.log('   ⚠️  No clickable elements found');
    }

    // Try to find and click on a paper
    console.log('');
    console.log('4. Looking for papers to open...');

    // Check if there are any paper cards or links
    const paperLinks = await page.$$eval('a, button', (elements) => {
      return elements
        .map((el) => ({
          text: el.textContent?.trim() || '',
          href: el.getAttribute('href') || '',
          tagName: el.tagName,
        }))
        .filter((el) => el.text.length > 0 || el.href.length > 0);
    });

    console.log(`   Found ${paperLinks.length} potential clickable elements`);

    // Look for library items or paper titles
    const libraryItems = await page.$$eval('*', (elements) => {
      return Array.from(elements)
        .filter((el) => {
          const text = el.textContent || '';
          const hasBibcode = /^\d{4}(arXiv|ApJ|MNRAS|A&A)/.test(text.trim());
          return hasBibcode && text.length < 50;
        })
        .map((el) => ({
          text: el.textContent?.trim() || '',
          tagName: el.tagName,
        }))
        .slice(0, 5);
    });

    if (libraryItems.length > 0) {
      console.log(`   Found ${libraryItems.length} potential bibcodes on page:`);
      libraryItems.forEach((item) => {
        console.log(`     - ${item.text} (${item.tagName})`);
      });
    }

    // Step 4: Try to trigger paper content API directly
    console.log('');
    console.log('5. Testing paper content API directly...');

    // Get a bibcode from the libraries API first
    const librariesApiReq = apiRequests.find((req) => req.url.includes('/api/libraries'));
    let testBibcode: string | null = null;

    if (librariesApiReq?.response?.body?.items && librariesApiReq.response.body.items.length > 0) {
      testBibcode = librariesApiReq.response.body.items[0].bibcode;
      console.log(`   Found bibcode from API: ${testBibcode}`);
    } else {
      // Try to fetch libraries API manually
      console.log('   Fetching libraries API to get a test bibcode...');
      const librariesResponse = await page.evaluate(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/libraries?library=Benchmarks&rows=5&metadata=true`);
        return response.json();
      }, baseUrl);

      if (librariesResponse?.items && librariesResponse.items.length > 0) {
        testBibcode = librariesResponse.items[0].bibcode;
        console.log(`   ✅ Got bibcode: ${testBibcode}`);
      }
    }

    if (testBibcode) {
      console.log('');
      console.log(`6. Testing paper content API for bibcode: ${testBibcode}`);

      // Make direct API call to paper content endpoint
      const contentResponse = await page.evaluate(
        async ({ baseUrl, bibcode }: { baseUrl: string; bibcode: string }) => {
          const encodedBibcode = encodeURIComponent(bibcode);
          const response = await fetch(`${baseUrl}/api/papers/${encodedBibcode}/content`);
          const data = await response.json();
          return {
            status: response.status,
            statusText: response.statusText,
            data,
            url: response.url,
          };
        },
        { baseUrl, bibcode: testBibcode }
      ) as {
        status: number;
        statusText: string;
        data?: {
          source?: string;
          html?: string;
          abstract?: string;
          sections?: Array<unknown>;
        };
        url: string;
      };

      console.log(`   API Status: ${contentResponse.status} ${contentResponse.statusText}`);
      console.log(`   Response source: ${contentResponse.data?.source || 'unknown'}`);
      console.log(`   Has HTML: ${!!contentResponse.data?.html}`);
      console.log(`   HTML length: ${contentResponse.data?.html?.length || 0}`);
      console.log(`   Has abstract: ${!!contentResponse.data?.abstract}`);
      console.log(`   Has sections: ${!!contentResponse.data?.sections?.length}`);
      console.log(`   Sections count: ${contentResponse.data?.sections?.length || 0}`);

      if (contentResponse.data?.source === 'abstract') {
        console.log('');
        console.log('   ❌ ISSUE FOUND: Paper is showing abstract-only!');
        console.log(`   Source: ${contentResponse.data.source}`);
        console.log(`   HTML preview: ${contentResponse.data.html?.substring(0, 200)}...`);
      } else if (contentResponse.data?.source === 'ar5iv') {
        console.log('');
        console.log('   ✅ Paper content from ar5iv');
        console.log(`   HTML length: ${contentResponse.data.html?.length || 0}`);
      } else if (contentResponse.data?.source === 'ads') {
        console.log('');
        console.log('   ✅ Paper content from ADS');
        console.log(`   HTML length: ${contentResponse.data.html?.length || 0}`);
      }

      // Check what went wrong
      if (contentResponse.data?.source === 'abstract') {
        console.log('');
        console.log('7. Investigating why full text is not available...');
        console.log(`   Bibcode: ${testBibcode}`);
        console.log(`   Arxiv URL: ${contentResponse.data.arxivUrl || 'N/A'}`);
        console.log(`   Arxiv ID: ${contentResponse.data.arxivId || 'N/A'}`);
        console.log(`   ADS URL: ${contentResponse.data.adsUrl || 'N/A'}`);
      }
    } else {
      console.log('   ⚠️  Could not find a bibcode to test');
    }

    // Step 5: Analyze all API requests
    console.log('');
    console.log('8. Analyzing all API requests...');
    console.log(`   Total API requests captured: ${apiRequests.length}`);

    const paperContentRequests = apiRequests.filter((req) => req.url.includes('/api/papers/') && req.url.includes('/content'));
    if (paperContentRequests.length > 0) {
      console.log(`   Paper content API requests: ${paperContentRequests.length}`);
      paperContentRequests.forEach((req, i) => {
        console.log(`   Request ${i + 1}:`);
        console.log(`     URL: ${req.url}`);
        console.log(`     Method: ${req.method}`);
        if (req.response) {
          console.log(`     Status: ${req.response.status} ${req.response.statusText}`);
          if (req.response.body) {
            const body = req.response.body;
            console.log(`     Source: ${body.source || 'unknown'}`);
            console.log(`     HTML length: ${body.html?.length || 0}`);
            if (body.error) {
              console.log(`     Error: ${body.error}`);
            }
          }
        }
      });
    }

    // Step 6: Check for errors
    if (consoleErrors.length > 0) {
      console.log('');
      console.log('9. Console errors found:');
      consoleErrors.forEach((err) => {
        console.log(`   - ${err}`);
      });
    }

    // Step 7: Take screenshot
    console.log('');
    console.log('10. Taking screenshot...');
    await page.screenshot({ path: 'paper-content-investigation.png', fullPage: true });
    console.log('   Screenshot saved to paper-content-investigation.png');

    // Step 8: Summary
    console.log('');
    console.log('=== SUMMARY ===');
    if (testBibcode) {
      const contentReq = apiRequests.find((req) => req.url.includes(testBibcode) && req.url.includes('/content'));
      if (contentReq?.response?.body) {
        const source = contentReq.response.body.source;
        if (source === 'abstract') {
          console.log('❌ ISSUE CONFIRMED: Paper showing abstract-only');
          console.log(`   Bibcode: ${testBibcode}`);
          console.log(`   Check logs above for details on why full text is not available`);
        } else {
          console.log(`✅ Paper content available from: ${source}`);
        }
      }
    }

    // Keep browser open for manual inspection
    console.log('');
    console.log('Browser will stay open for 15 seconds for manual inspection...');
    await setTimeout(15000);
  } catch (error) {
    console.error('Error during investigation:', error);
    await page.screenshot({ path: 'paper-content-investigation-error.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

investigate().catch(console.error);

