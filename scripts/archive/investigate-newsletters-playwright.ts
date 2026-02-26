/**
 * Use Playwright to interact with the web page and investigate why only 1 newsletter item shows in daily view
 */

import { chromium } from 'playwright';
import { setTimeout } from 'timers/promises';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function investigate() {
  console.log('=== PLAYWRIGHT INTERACTIVE INVESTIGATION ===');
  console.log('');

  // Note: dev server runs on port 3002 (see package.json: "dev": "next dev -p 3002")
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
    slowMo: 500 // Slow down actions to see what's happening
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture network requests
  const networkRequests: Array<{ url: string; method: string; response?: any }> = [];
  page.on('request', request => {
    if (request.url().includes('/api/items')) {
      networkRequests.push({ url: request.url(), method: request.method() });
    }
  });

  // Capture API responses
  page.on('response', async response => {
    if (response.url().includes('/api/items')) {
      try {
        const data = await response.json();
        const lastRequest = networkRequests[networkRequests.length - 1];
        if (lastRequest) {
          lastRequest.response = data;
        }
      } catch (e) {
        // Not JSON
      }
    }
  });

  // Capture console errors
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // Step 1: Navigate to the page
    console.log('1. Navigating to homepage...');
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 10000 });
    await setTimeout(1000);

    // Check if we're on login page and auto-login
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.log('   Login required - auto-logging in...');

      // Wait for password input
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });

      // Fill in password
      await page.fill('input[type="password"]', uiPassword);
      await setTimeout(500);

      // Submit form
      await page.click('button[type="submit"]');

      // Wait for redirect (should go to home page)
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
      await setTimeout(1000);

      console.log('   ✅ Logged in successfully');
    }

    // Step 2: Interact with the page - click "Newsletters" category
    console.log('');
    console.log('2. Clicking "Newsletters" category tab...');
    const newslettersTab = page.locator('button:has-text("Newsletters")');
    await newslettersTab.waitFor({ state: 'visible', timeout: 5000 });
    await newslettersTab.click();
    await setTimeout(1000);

    // Step 3: Click "Daily" period button
    console.log('');
    console.log('3. Clicking "Daily" period button...');
    const dailyButton = page.locator('button:has-text("Daily")');
    await dailyButton.waitFor({ state: 'visible', timeout: 5000 });
    await dailyButton.click();
    await setTimeout(2000); // Wait for items to load

    // Step 4: Intercept and log the API call
    console.log('');
    console.log('4. Checking API call made by frontend...');
    if (networkRequests.length > 0) {
      const lastRequest = networkRequests[networkRequests.length - 1];
      console.log(`   API URL: ${lastRequest.url}`);
      if (lastRequest.response) {
        const apiData = lastRequest.response;
        console.log(`   API returned: ${apiData.items?.length || 0} items`);
        console.log(`   Total items: ${apiData.totalItems}`);
        console.log(`   Items ranked: ${apiData.itemsRanked}`);

        if (apiData.items && apiData.items.length > 0) {
          console.log('');
          console.log('   First 3 items from API response:');
          apiData.items.slice(0, 3).forEach((item: any, i: number) => {
            console.log(`     ${i + 1}. ${item.title.substring(0, 50)}...`);
            console.log(`        Score: ${item.finalScore.toFixed(3)} (displays as ${item.finalScore.toFixed(2)})`);
            console.log(`        Source: ${item.sourceTitle}`);
          });
        }
      }
    } else {
      console.log('   ⚠️  No API call detected (may still be loading)');
      await setTimeout(2000); // Wait a bit more
    }

    // Step 5: Count visible items on the page
    console.log('');
    console.log('5. Counting visible items on the page...');

    // Wait for items to appear
    try {
      await page.waitForSelector('.border.rounded-lg.p-4', { timeout: 5000 });
    } catch {
      console.log('   ⚠️  No items found with selector .border.rounded-lg.p-4');
    }

    const itemCards = page.locator('.border.rounded-lg.p-4');
    const itemCount = await itemCards.count();
    console.log(`   Item cards found: ${itemCount}`);

    // Step 6: Extract details from visible items
    console.log('');
    console.log('6. Extracting details from visible items...');
    const visibleItems = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.border.rounded-lg.p-4'));
      return cards.map((card, index) => {
        const titleEl = card.querySelector('a[href^="http"]');
        const scoreEl = card.querySelector('span.font-semibold');
        const sourceEl = card.querySelector('span.font-medium');
        const rankEl = card.querySelector('span.text-2xl.font-bold');

        return {
          rank: rankEl?.textContent?.trim() || (index + 1).toString(),
          title: titleEl?.textContent?.trim() || '',
          score: scoreEl?.textContent?.trim() || '',
          source: sourceEl?.textContent?.trim() || '',
          url: titleEl?.getAttribute('href') || ''
        };
      });
    });

    console.log(`   Visible items: ${visibleItems.length}`);
    visibleItems.forEach(item => {
      console.log(`     ${item.rank}. ${item.title.substring(0, 60)}...`);
      console.log(`        Score: ${item.score}, Source: ${item.source}`);
    });

    // Step 7: Check for loading states or errors
    console.log('');
    console.log('7. Checking for loading states or errors...');
    const loadingText = await page.locator('text=Loading').count();
    const errorText = await page.locator('text=/error|Error/').count();
    const noItemsText = await page.locator('text=/No items|no items/').count();

    if (loadingText > 0) {
      console.log('   ⚠️  Page still shows "Loading" state');
    }
    if (errorText > 0) {
      console.log('   ⚠️  Error message detected on page');
    }
    if (noItemsText > 0) {
      console.log('   ⚠️  "No items" message detected');
    }

    // Step 8: Take screenshot
    console.log('');
    console.log('8. Taking screenshot...');
    await page.screenshot({ path: 'newsletters-investigation.png', fullPage: true });
    console.log('   Screenshot saved to newsletters-investigation.png');

    // Step 9: Summary
    console.log('');
    console.log('=== SUMMARY ===');
    const apiItemCount = networkRequests.length > 0 && networkRequests[networkRequests.length - 1].response
      ? networkRequests[networkRequests.length - 1].response.items?.length || 0
      : 0;

    console.log(`API returned: ${apiItemCount} items`);
    console.log(`UI displayed: ${visibleItems.length} items`);
    console.log('');

    if (apiItemCount === 0) {
      console.log('❌ API returned 0 items - check API endpoint');
    } else if (visibleItems.length === 0) {
      console.log('❌ UI shows 0 items but API returned items - frontend rendering issue');
    } else if (apiItemCount !== visibleItems.length) {
      console.log(`❌ MISMATCH: API returned ${apiItemCount} items but UI shows ${visibleItems.length}`);
      console.log('   This suggests a frontend filtering or rendering issue.');
    } else if (visibleItems.length === 1) {
      console.log('❌ Only 1 item displayed (matches API)');
      console.log('   This suggests the API is only returning 1 item.');
      console.log('   Check the selection/ranking logic.');
    } else {
      console.log(`✅ ${visibleItems.length} items displayed correctly`);
    }

    if (consoleErrors.length > 0) {
      console.log('');
      console.log('⚠️  Console errors found:');
      consoleErrors.forEach(err => console.log(`   - ${err}`));
    }

    // Keep browser open for manual inspection
    console.log('');
    console.log('Browser will stay open for 10 seconds for manual inspection...');
    await setTimeout(10000);

  } catch (error) {
    console.error('Error during investigation:', error);
    await page.screenshot({ path: 'newsletters-investigation-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
}

investigate().catch(console.error);
