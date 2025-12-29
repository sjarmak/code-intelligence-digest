#!/usr/bin/env tsx
/**
 * Check paper content availability
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { getPaper } from '../src/lib/db/ads-papers';
import { getCachedHtmlContent } from '../src/lib/db/paper-annotations';
import { extractArxivId } from '../src/lib/ar5iv/parser';

async function checkPaper(bibcode: string) {
  console.log(`\n🔍 Checking paper: ${bibcode}\n`);

  // Get paper from database
  const paper = await getPaper(bibcode);
  if (!paper) {
    console.log('❌ Paper not found in database');
    return;
  }

  console.log(`✅ Paper found:`);
  console.log(`   Title: ${paper.title || 'N/A'}`);
  console.log(`   Has abstract: ${!!paper.abstract}`);
  console.log(`   Has body: ${!!paper.body}`);
  console.log(`   Body length: ${paper.body?.length || 0} chars`);
  console.log(`   ArXiv URL: ${paper.arxivUrl || 'N/A'}`);
  console.log(`   ArXiv ID: ${extractArxivId(bibcode) || 'N/A'}`);

  // Check cached HTML
  const cached = await getCachedHtmlContent(bibcode);
  if (cached) {
    console.log(`\n📦 Cached HTML:`);
    console.log(`   HTML length: ${cached.htmlContent.length} chars`);
    console.log(`   Fetched at: ${new Date(cached.htmlFetchedAt * 1000).toISOString()}`);
    console.log(`   Sections: ${cached.sections?.length || 0}`);
    console.log(`   Figures: ${cached.figures?.length || 0}`);

    // Check source
    const htmlLower = cached.htmlContent.toLowerCase();
    let source = 'unknown';
    if (htmlLower.includes('paper-reader-abstract-only')) {
      source = 'abstract-only';
    } else if (htmlLower.includes('paper-reader-ads')) {
      source = 'ads';
    } else if (htmlLower.includes('ar5iv') || htmlLower.includes('ltx_')) {
      source = 'ar5iv';
    } else if (htmlLower.includes('arxiv.org/html/')) {
      source = 'arxiv';
    }
    console.log(`   Detected source: ${source}`);

    // Check for images
    const imgMatches = cached.htmlContent.match(/<img[^>]*>/gi);
    console.log(`   Image tags: ${imgMatches?.length || 0}`);
    if (imgMatches && imgMatches.length > 0) {
      console.log(`\n   First few images:`);
      imgMatches.slice(0, 3).forEach((img, i) => {
        const srcMatch = img.match(/src\s*=\s*["']?([^"'\s>]+)["']?/i);
        if (srcMatch) {
          const src = srcMatch[1];
          console.log(`     ${i + 1}. ${src.substring(0, 80)}${src.length > 80 ? '...' : ''}`);
          console.log(`        isAbsolute: ${src.startsWith('http://') || src.startsWith('https://')}`);
        }
      });
    }
  } else {
    console.log(`\n❌ No cached HTML`);
  }

  console.log('');
}

const bibcode = process.argv[2];
if (!bibcode) {
  console.log('Usage: npx tsx scripts/check-paper-content.ts <bibcode>');
  console.log('\nExample: npx tsx scripts/check-paper-content.ts 2025arXiv251206710M');
  process.exit(1);
}

checkPaper(bibcode).catch(console.error);

