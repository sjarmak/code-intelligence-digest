/**
 * Decode HTML entities in text
 * Handles both named entities (&amp;) and numeric entities (&#9889; or &#x26A1;)
 */

/**
 * Decode HTML entities in a string
 * Converts entities like &amp;, &#9889;, &#x26A1; to their actual characters
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;

  // First decode numeric entities (decimal: &#9889; and hex: &#x26A1;)
  let decoded = text
    // Decimal numeric entities: &#9889;
    .replace(/&#(\d+);/g, (match, dec) => {
      try {
        const codePoint = parseInt(dec, 10);
        // Handle high code points (emoji, etc.) that need surrogate pairs
        if (codePoint > 0xFFFF) {
          return String.fromCodePoint(codePoint);
        }
        return String.fromCharCode(codePoint);
      } catch {
        return match; // Return original if decoding fails
      }
    })
    // Hexadecimal numeric entities: &#x26A1; or &#X26A1;
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      try {
        const codePoint = parseInt(hex, 16);
        // Handle high code points (emoji, etc.) that need surrogate pairs
        if (codePoint > 0xFFFF) {
          return String.fromCodePoint(codePoint);
        }
        return String.fromCharCode(codePoint);
      } catch {
        return match; // Return original if decoding fails
      }
    });

  // Then decode named entities (common ones)
  const namedEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&hellip;': '…',
    '&mdash;': '—',
    '&ndash;': '–',
  };

  // Replace named entities (case-insensitive)
  for (const [entity, replacement] of Object.entries(namedEntities)) {
    const regex = new RegExp(entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    decoded = decoded.replace(regex, replacement);
  }

  return decoded;
}

