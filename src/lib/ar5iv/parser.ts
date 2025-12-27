/**
 * ar5iv HTML parser
 * Fetches and parses ar5iv.org HTML renderings of arXiv papers
 *
 * ar5iv.org is a project that renders arXiv LaTeX sources as accessible HTML5
 * See: https://ar5iv.org
 */

import { logger } from '../logger';

export interface PaperSection {
  id: string;
  title: string;
  level: number; // 1 = h1, 2 = h2, etc.
  content?: string; // HTML content of section
}

export interface PaperFigure {
  id: string;
  src: string;
  caption: string;
  alt?: string;
}

export interface ParsedPaperContent {
  source: 'ar5iv' | 'ads' | 'abstract';
  html: string; // Cleaned HTML content
  title?: string;
  authors?: string[];
  abstract?: string;
  sections: PaperSection[];
  figures: PaperFigure[];
  tableOfContents: PaperSection[];
  rawHtml?: string; // Original HTML for debugging
}

/**
 * Extract arXiv ID from bibcode
 * Examples:
 *   "2025arXiv250100123A" -> "2501.00123"
 *   "2024arXiv241234567X" -> "2412.34567"
 */
export function extractArxivId(bibcode: string): string | null {
  // Pattern: YYYYarXivYYMMNNNNNL where YY=year, MM=month, NNNNN=number, L=letter
  const match = bibcode.match(/^(\d{4})arXiv(\d{2})(\d{2})(\d{5})/);
  if (match) {
    const [, , yearSuffix, month, number] = match;
    // arXiv ID format: YYMM.NNNNN
    return `${yearSuffix}${month}.${number}`;
  }

  // Check for direct arXiv ID in the bibcode
  const directMatch = bibcode.match(/(\d{4}\.\d{4,5})/);
  if (directMatch) {
    return directMatch[1];
  }

  return null;
}

/**
 * Fetch paper HTML from ar5iv.org
 */
export async function fetchAr5ivHtml(arxivId: string): Promise<string> {
  const url = `https://ar5iv.org/html/${arxivId}`;

  logger.info('Fetching ar5iv HTML', { arxivId, url });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CodeIntelDigest/1.0 (Research paper reader)',
      'Accept': 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(`ar5iv fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Clean and sanitize HTML content for safe rendering
 * Removes scripts, styles, and potentially harmful elements
 */
function sanitizeHtml(html: string): string {
  // Remove script tags and their content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags and their content
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove on* event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  cleaned = cleaned.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');

  // Remove data: URLs (except for images)
  cleaned = cleaned.replace(/src\s*=\s*["']data:(?!image)[^"']*["']/gi, 'src=""');

  return cleaned;
}

/**
 * Parse ar5iv HTML into structured content
 */
export function parseAr5ivHtml(html: string): ParsedPaperContent {
  const sections: PaperSection[] = [];
  const figures: PaperFigure[] = [];
  const tableOfContents: PaperSection[] = [];

  // Extract title from <h1 class="ltx_title"> or <title>
  let title: string | undefined;
  const titleMatch = html.match(/<h1[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = stripHtmlTags(titleMatch[1]).trim();
  } else {
    const pageTitleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (pageTitleMatch) {
      title = pageTitleMatch[1].replace(/\s*-\s*ar5iv$/i, '').trim();
    }
  }

  // Extract authors from <span class="ltx_personname">
  const authors: string[] = [];
  const authorMatches = html.matchAll(/<span[^>]*class="[^"]*ltx_personname[^"]*"[^>]*>([\s\S]*?)<\/span>/gi);
  for (const match of authorMatches) {
    const author = stripHtmlTags(match[1]).trim();
    if (author && !authors.includes(author)) {
      authors.push(author);
    }
  }

  // Extract abstract
  let abstract: string | undefined;
  const abstractMatch = html.match(/<div[^>]*class="[^"]*ltx_abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (abstractMatch) {
    abstract = stripHtmlTags(abstractMatch[1]).trim();
  }

  // Extract sections from headings
  const sectionRegex = /<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let sectionMatch;
  let sectionIndex = 0;

  while ((sectionMatch = sectionRegex.exec(html)) !== null) {
    const level = parseInt(sectionMatch[1].substring(1), 10);
    const id = sectionMatch[2] || `section-${sectionIndex}`;
    const sectionTitle = stripHtmlTags(sectionMatch[3]).trim();

    if (sectionTitle && !sectionTitle.toLowerCase().includes('abstract')) {
      const section: PaperSection = {
        id,
        title: sectionTitle,
        level,
      };
      sections.push(section);
      tableOfContents.push(section);
      sectionIndex++;
    }
  }

  // Extract figures
  const figureRegex = /<figure[^>]*(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/figure>/gi;
  let figureMatch;
  let figureIndex = 0;

  while ((figureMatch = figureRegex.exec(html)) !== null) {
    const figureHtml = figureMatch[2];
    const figureId = figureMatch[1] || `figure-${figureIndex}`;

    // Extract image src
    const imgMatch = figureHtml.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const src = imgMatch ? imgMatch[1] : '';

    // Extract alt text
    const altMatch = figureHtml.match(/alt="([^"]*)"/i);
    const alt = altMatch ? altMatch[1] : undefined;

    // Extract caption
    const captionMatch = figureHtml.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    const caption = captionMatch ? stripHtmlTags(captionMatch[1]).trim() : '';

    if (src) {
      figures.push({
        id: figureId,
        src: normalizeImageSrc(src),
        caption,
        alt,
      });
      figureIndex++;
    }
  }

  // Extract main article content
  let mainContent = html;

  // Try to find the main article body
  const articleMatch = html.match(/<article[^>]*class="[^"]*ltx_document[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    mainContent = articleMatch[1];
  } else {
    // Fallback: find content div
    const contentMatch = html.match(/<div[^>]*class="[^"]*ltx_page_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<footer|<\/body)/i);
    if (contentMatch) {
      mainContent = contentMatch[1];
    }
  }

  // Clean up the HTML
  mainContent = sanitizeHtml(mainContent);

  // Remove navigation elements
  mainContent = mainContent.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');

  // Remove header elements (but keep h1-h6)
  mainContent = mainContent.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Remove footer elements
  mainContent = mainContent.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Add IDs to sections for scroll anchoring if missing
  mainContent = addSectionIds(mainContent);

  // Wrap content in a reader-friendly container
  const wrappedHtml = `
    <div class="paper-reader-content">
      ${mainContent}
    </div>
  `;

  return {
    source: 'ar5iv',
    html: wrappedHtml.trim(),
    title,
    authors: authors.length > 0 ? authors : undefined,
    abstract,
    sections,
    figures,
    tableOfContents,
    rawHtml: html,
  };
}

/**
 * Strip HTML tags from a string
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize image src URLs to absolute paths
 */
function normalizeImageSrc(src: string): string {
  if (src.startsWith('//')) {
    return `https:${src}`;
  }
  if (src.startsWith('/')) {
    return `https://ar5iv.org${src}`;
  }
  if (!src.startsWith('http')) {
    return `https://ar5iv.org/${src}`;
  }
  return src;
}

/**
 * Add IDs to sections that don't have them
 */
function addSectionIds(html: string): string {
  let sectionCount = 0;

  return html.replace(/<(section|div)[^>]*class="[^"]*ltx_section[^"]*"[^>]*>/gi, (match) => {
    if (!match.includes('id=')) {
      sectionCount++;
      return match.replace(/^<(section|div)/, `<$1 id="section-${sectionCount}"`);
    }
    return match;
  });
}

/**
 * Convert ADS full text to HTML format
 */
export function adsBodyToHtml(body: string, abstract?: string): ParsedPaperContent {
  // ADS body is usually plain text or light markdown
  // Convert to simple HTML paragraphs

  const paragraphs = body
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p>${escapeHtml(p.trim())}</p>`)
    .join('\n');

  const sections: PaperSection[] = [];

  if (abstract) {
    sections.push({
      id: 'abstract',
      title: 'Abstract',
      level: 2,
    });
  }

  sections.push({
    id: 'body',
    title: 'Full Text',
    level: 2,
  });

  const html = `
    <div class="paper-reader-content paper-reader-ads">
      ${abstract ? `
        <section id="abstract" class="paper-section">
          <h2>Abstract</h2>
          <p>${escapeHtml(abstract)}</p>
        </section>
      ` : ''}
      <section id="body" class="paper-section">
        <h2>Full Text</h2>
        ${paragraphs}
      </section>
    </div>
  `;

  return {
    source: 'ads',
    html: html.trim(),
    abstract,
    sections,
    figures: [],
    tableOfContents: sections,
  };
}

/**
 * Create abstract-only fallback HTML
 */
export function abstractToHtml(abstract: string, title?: string): ParsedPaperContent {
  const html = `
    <div class="paper-reader-content paper-reader-abstract-only">
      ${title ? `<h1 class="paper-title">${escapeHtml(title)}</h1>` : ''}
      <section id="abstract" class="paper-section">
        <h2>Abstract</h2>
        <p>${escapeHtml(abstract)}</p>
      </section>
      <div class="paper-notice">
        <p>Full text is not available for this paper.
        <a href="#" target="_blank" rel="noopener">View on arXiv</a> or
        <a href="#" target="_blank" rel="noopener">View on ADS</a> for the complete paper.</p>
      </div>
    </div>
  `;

  return {
    source: 'abstract',
    html: html.trim(),
    title,
    abstract,
    sections: [{
      id: 'abstract',
      title: 'Abstract',
      level: 2,
    }],
    figures: [],
    tableOfContents: [{
      id: 'abstract',
      title: 'Abstract',
      level: 2,
    }],
  };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Fetch and parse paper content with fallbacks
 */
export async function fetchPaperContent(
  bibcode: string,
  options: {
    adsBody?: string;
    abstract?: string;
    title?: string;
    arxivUrl?: string;
  } = {}
): Promise<ParsedPaperContent> {
  const arxivId = extractArxivId(bibcode);

  // Try ar5iv first for arXiv papers
  if (arxivId) {
    try {
      logger.info('Attempting ar5iv fetch', { bibcode, arxivId });
      const html = await fetchAr5ivHtml(arxivId);
      const parsed = parseAr5ivHtml(html);

      // Verify we got meaningful content
      if (parsed.html.length > 500) {
        logger.info('ar5iv fetch successful', { bibcode, contentLength: parsed.html.length });
        return parsed;
      }
      logger.warn('ar5iv returned minimal content, falling back', { bibcode });
    } catch (error) {
      logger.warn('ar5iv fetch failed, falling back', {
        bibcode,
        arxivId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback to ADS body
  if (options.adsBody) {
    logger.info('Using ADS body fallback', { bibcode });
    return adsBodyToHtml(options.adsBody, options.abstract);
  }

  // Final fallback: abstract only
  if (options.abstract) {
    logger.info('Using abstract-only fallback', { bibcode });
    return abstractToHtml(options.abstract, options.title);
  }

  // No content available
  throw new Error(`No content available for paper ${bibcode}`);
}
