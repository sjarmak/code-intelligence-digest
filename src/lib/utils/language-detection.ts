/**
 * Simple language detection for filtering non-English content
 * Uses heuristics to detect non-English text
 */

/**
 * Detect if text is likely non-English
 * Returns true if text appears to be non-English
 *
 * Simple heuristic: Check for non-ASCII characters that are common in non-English languages
 * This is a basic check - for production, consider using a proper language detection library
 */
export function isNonEnglish(text: string): boolean {
  if (!text || text.length === 0) {
    return false;
  }

  // Check for common non-English character ranges
  // Japanese: Hiragana (3040-309F), Katakana (30A0-30FF), Kanji (4E00-9FFF)
  // Chinese: CJK Unified Ideographs (4E00-9FFF)
  // Korean: Hangul (AC00-D7AF)
  // Arabic: Arabic (0600-06FF)
  // Cyrillic: Cyrillic (0400-04FF)
  // And other common non-Latin scripts

  const nonEnglishPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0400-\u04FF]/;

  // If we find any non-English characters, it's likely non-English
  if (nonEnglishPattern.test(text)) {
    return true;
  }

  // Additional check: If title has very few ASCII characters, it might be non-English
  // But be lenient - allow some non-ASCII for proper names, etc.
  const asciiChars = text.match(/[a-zA-Z0-9\s.,!?;:'"()\-]/g) || [];
  const asciiRatio = asciiChars.length / text.length;

  // If less than 50% ASCII characters, likely non-English
  if (asciiRatio < 0.5 && text.length > 10) {
    return true;
  }

  return false;
}

/**
 * Check if an item should be filtered out due to non-English content
 */
export function shouldFilterNonEnglish(item: { title: string; summary?: string; contentSnippet?: string }): boolean {
  // Check title first (most important)
  if (isNonEnglish(item.title)) {
    return true;
  }

  // Check summary if available
  if (item.summary && item.summary.length > 50 && isNonEnglish(item.summary)) {
    return true;
  }

  // Check content snippet if available
  if (item.contentSnippet && item.contentSnippet.length > 50 && isNonEnglish(item.contentSnippet)) {
    return true;
  }

  return false;
}

