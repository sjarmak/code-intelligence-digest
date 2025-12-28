#!/usr/bin/env tsx
/**
 * Playwright test to investigate why daily items aren't showing up
 * Tests the actual UI to see what's happening
 */

import { chromium, Browser, Page } from 'playwright';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3002';
const UI_PASSWORD = process.env.UI_PASSWORD;

async function testDailyItems() {
  console.log('🔍 Testing daily items display with Playwright...\n');

  if (!UI_PASSWORD) {
    console.error('❌ UI_PASSWORD environment variable is not set');
    console.log('Testing API directly instead...');
    await testAPIDirectly();
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to home page
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Wait for page to load
    await page.waitForTimeout(2000);

    // Check if we need to login
    const loginPage = page.locator('input[type="password"]');
    if (await loginPage.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('🔐 Login required - authenticating...');

      // Fill in password
      await loginPage.fill(UI_PASSWORD);
      console.log('  ✅ Password entered');

      // Submit form
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();
      console.log('  ✅ Login form submitted');

      // Wait for redirect
      await page.waitForURL('**/', { timeout: 5000 });
      await page.waitForTimeout(1000);
      console.log('  ✅ Authenticated successfully\n');
    }

    // Find and click "Daily" button
    console.log('Looking for Daily button...');
    const dailyButton = page.locator('button:has-text("Daily")').first();
    if (await dailyButton.isVisible({ timeout: 5000 })) {
      await dailyButton.click();
      await page.waitForTimeout(1000);
      console.log('✅ Clicked Daily button');
    } else {
      console.log('❌ Daily button not found');
    }

    // Test each category
    const categories = [
      { id: 'newsletters', label: 'Newsletters' },
      { id: 'podcasts', label: 'Podcasts' },
      { id: 'tech_articles', label: 'Tech Articles' },
      { id: 'ai_news', label: 'AI News' },
      { id: 'product_news', label: 'Product News' },
      { id: 'community', label: 'Community' },
      { id: 'research', label: 'Research' },
    ];

    for (const category of categories) {
      console.log(`\n📋 Testing category: ${category.label}`);

      // Click category tab
      const categoryTab = page.locator(`button:has-text("${category.label}")`).first();
      if (await categoryTab.isVisible({ timeout: 2000 })) {
        await categoryTab.click();
        await page.waitForTimeout(1500);
        console.log(`  ✅ Clicked ${category.label} tab`);
      } else {
        console.log(`  ❌ ${category.label} tab not found`);
        continue;
      }

      // Check for loading state
      const loadingText = page.locator('text=/loading/i');
      if (await loadingText.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log('  ⏳ Waiting for items to load...');
        await page.waitForSelector('text=/loading/i', { state: 'hidden', timeout: 10000 });
      }

      // Wait for items to load (check for loading state first)
      await page.waitForTimeout(2000);

      // Intercept API response to see what's actually returned
      let apiResponseData: any = null;
      page.on('response', async (response) => {
        if (response.url().includes(`/api/items?category=${category.id}&period=day`)) {
          try {
            apiResponseData = await response.json();
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      });

      // Wait a bit for API call to complete
      await page.waitForTimeout(3000);

      if (apiResponseData) {
        console.log(`  🌐 API returned: ${apiResponseData.totalItems || 0} total, ${apiResponseData.items?.length || 0} items`);
        if (apiResponseData.items && apiResponseData.items.length > 0) {
          console.log(`     First item: ${apiResponseData.items[0].title.substring(0, 50)}...`);
        } else {
          console.log(`     ⚠️  API returned 0 items but totalItems=${apiResponseData.totalItems}`);
        }
      }

      // Look for actual item cards - check for ItemCard components
      // Items should be in a container with item cards
      const itemCards = page.locator('[class*="item"], article, a[href^="http"]:not([href*="localhost"]):not([href*="127.0.0.1"])');
      let itemCount = 0;
      const validItems: string[] = [];

      // Count items that look like actual content (not navigation/buttons)
      const allLinks = await page.locator('a[href^="http"]').all();
      for (const link of allLinks) {
        const href = await link.getAttribute('href').catch(() => '');
        const text = await link.textContent().catch(() => '');
        // Filter out internal links and navigation
        if (href &&
            !href.includes('localhost') &&
            !href.includes('127.0.0.1') &&
            !href.includes('/login') &&
            !href.includes('/admin') &&
            text &&
            text.length > 10 &&
            !text.includes('Generate') &&
            !text.includes('Daily') &&
            !text.includes('Weekly')) {
          validItems.push(text.trim());
          itemCount++;
        }
      }

      console.log(`  📊 Found ${itemCount} content items in UI`);

      if (itemCount === 0) {
        // Check for error messages
        const errorText = await page.locator('text=/error|failed/i').first().textContent().catch(() => null);
        if (errorText) {
          console.log(`  ❌ Error: ${errorText}`);
        }

        // Check for empty state
        const emptyText = await page.locator('text=/no items|empty|nothing|loading/i').first().textContent().catch(() => null);
        if (emptyText) {
          console.log(`  ℹ️  State: ${emptyText}`);
        }

        // Get page HTML to debug
        const bodyText = await page.locator('body').textContent().catch(() => '');
        if (bodyText.includes('Loading')) {
          console.log(`  ⏳ Still loading...`);
        }

        // Take screenshot
        await page.screenshot({ path: `.data/screenshot-${category.id}-empty.png`, fullPage: true });
        console.log(`  📸 Screenshot saved: .data/screenshot-${category.id}-empty.png`);
      } else {
        // Get first few item titles from validItems
        console.log(`  ✅ Items found:`);
        validItems.slice(0, 5).forEach((title, i) => {
          console.log(`     ${i + 1}. ${title.substring(0, 80)}...`);
        });
      }

      // Intercept and log API calls
      page.on('response', async (response) => {
        if (response.url().includes('/api/items')) {
          const data = await response.json().catch(() => null);
          if (data) {
            console.log(`  🌐 API Response: ${data.totalItems || 0} items, ${data.items?.length || 0} returned`);
            if (data.items && data.items.length === 0) {
              console.log(`     ⚠️  API returned 0 items but totalItems=${data.totalItems}`);
            }
          }
        }
      });
    }

    // Wait a bit before closing
    await page.waitForTimeout(2000);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: '.data/screenshot-error.png' });
  } finally {
    await browser.close();
  }
}

async function testAPIDirectly() {
  console.log('\n🔍 Testing API directly...\n');

  const categories = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];

  for (const category of categories) {
    try {
      const url = `${BASE_URL}/api/items?category=${category}&period=day`;
      console.log(`Testing: ${url}`);

      const response = await fetch(url);
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        console.log(`  ✅ ${category}: ${data.items.length} items returned`);
        console.log(`     Top item: ${data.items[0].title.substring(0, 50)}...`);
      } else {
        console.log(`  ❌ ${category}: No items returned`);
        console.log(`     Response: ${JSON.stringify(data, null, 2).substring(0, 200)}...`);
      }
    } catch (error) {
      console.error(`  ❌ ${category}: Error - ${error}`);
    }
  }
}

if (require.main === module) {
  testDailyItems().catch(console.error);
}

