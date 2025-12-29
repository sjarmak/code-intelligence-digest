#!/usr/bin/env tsx
/**
 * Debug script to check image URLs in a paper's HTML content
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getCachedHtmlContent } from '../src/lib/db/paper-annotations';
import { getPaper } from '../src/lib/db/ads-papers';
import { extractArxivId } from '../src/lib/ar5iv/parser';

async function debugPaperImages(bibcode: string) {
  console.log(`\n🔍 Debugging images for paper: ${bibcode}\n`);

  // Get cached HTML
  const cached = await getCachedHtmlContent(bibcode);
  if (!cached) {
    console.log('❌ No cached HTML found');
    return;
  }

  console.log(`✅ Found cached HTML (${cached.htmlContent.length} chars)\n`);

  // Extract all image references
  const imgMatches = cached.htmlContent.matchAll(/<img[^>]*>/gi);
  const images: Array<{ match: string; src?: string }> = [];

  for (const match of imgMatches) {
    const imgTag = match[0];
    const srcMatch = imgTag.match(/src\s*=\s*["']?([^"'\s>]+)["']?/i);

    images.push({
      match: imgTag,
      src: srcMatch ? srcMatch[1] : undefined,
    });
  }

  console.log(`📸 Found ${images.length} image tags:\n`);
  images.forEach((img, i) => {
    console.log(`${i + 1}. ${img.match.substring(0, 100)}${img.match.length > 100 ? '...' : ''}`);
    if (img.src) {
      console.log(`   src: ${img.src}`);
      console.log(`   isAbsolute: ${img.src.startsWith('http://') || img.src.startsWith('https://')}`);
      console.log(`   isRelative: ${img.src.startsWith('/')}`);
      console.log(`   isData: ${img.src.startsWith('data:')}`);
    }
    console.log('');
  });

  // Also check for background-image in styles
  const styleMatches = cached.htmlContent.matchAll(/style=["'][^"']*background[^"']*url\([^)]+\)[^"']*["']/gi);
  const backgroundImages: string[] = [];

  for (const match of styleMatches) {
    const urlMatch = match[0].match(/url\(["']?([^"')]+)["']?\)/i);
    if (urlMatch) {
      backgroundImages.push(urlMatch[1]);
    }
  }

  if (backgroundImages.length > 0) {
    console.log(`🎨 Found ${backgroundImages.length} background-image URLs:\n`);
    backgroundImages.forEach((url, i) => {
      console.log(`${i + 1}. ${url}`);
      console.log(`   isAbsolute: ${url.startsWith('http://') || url.startsWith('https://')}`);
      console.log(`   isRelative: ${url.startsWith('/')}`);
      console.log('');
    });
  }

  // Check figures metadata
  if (cached.figures && cached.figures.length > 0) {
    console.log(`\n📊 Found ${cached.figures.length} figures in metadata:\n`);
    cached.figures.forEach((fig, i) => {
      console.log(`${i + 1}. ${fig.id}: ${fig.src}`);
      console.log(`   caption: ${fig.caption.substring(0, 80)}${fig.caption.length > 80 ? '...' : ''}`);
      console.log('');
    });
  }
}

// Get bibcode from command line or search
const bibcode = process.argv[2];

if (!bibcode) {
  console.log('Usage: npx tsx scripts/debug-paper-images.ts <bibcode>');
  console.log('\nExample: npx tsx scripts/debug-paper-images.ts 2025arXiv251206710M');
  process.exit(1);
}

debugPaperImages(bibcode).catch(console.error);

