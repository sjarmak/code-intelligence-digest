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
  source: 'ar5iv' | 'arxiv' | 'ads' | 'abstract';
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
 * Fetch paper HTML from ar5iv.org or arXiv HTML
 * Tries multiple sources in order: ar5iv.labs, ar5iv.org, arxiv.org/html
 */
export async function fetchAr5ivHtml(arxivId: string): Promise<string> {
  // Try ar5iv.labs.arxiv.org first (the actual HTML rendering service)
  const urls = [
    `https://ar5iv.labs.arxiv.org/html/${arxivId}`,
    `https://ar5iv.org/html/${arxivId}`,
    `https://arxiv.org/html/${arxivId}v1`, // arXiv's own HTML version
  ];

  let lastError: Error | null = null;

  for (const url of urls) {
    logger.info('Fetching HTML', { arxivId, url, source: url.includes('ar5iv') ? 'ar5iv' : 'arxiv' });

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CodeIntelDigest/1.0 (Research paper reader)',
          'Accept': 'text/html',
        },
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error response');
        logger.warn('HTML fetch failed, trying next source', {
          arxivId,
          url,
          status: response.status,
          statusText: response.statusText,
        });
        lastError = new Error(`HTML fetch failed: ${response.status} ${response.statusText}`);
        continue; // Try next URL
      }

      const html = await response.text();

      // Verify we got actual HTML content, not an error page
      if (html.length < 100) {
        logger.warn('HTML returned very short response, trying next source', {
          arxivId,
          url,
          htmlLength: html.length,
        });
        lastError = new Error('HTML returned insufficient content');
        continue; // Try next URL
      }

      // Check for common error indicators in HTML
      const htmlLower = html.toLowerCase();
      if (htmlLower.includes('404') || htmlLower.includes('not found') || htmlLower.includes('page not found')) {
        logger.warn('HTML returned error page, trying next source', {
          arxivId,
          url,
          htmlLength: html.length,
        });
        lastError = new Error('HTML returned error page (404)');
        continue; // Try next URL
      }

      // Check if we got redirected to abstract page (for ar5iv URLs)
      if (url.includes('ar5iv') && (htmlLower.includes('arxiv.org/abs/') || html.includes('submission history'))) {
        logger.warn('ar5iv redirected to abstract page, trying next source', {
          arxivId,
          url,
        });
        lastError = new Error('ar5iv returned abstract page');
        continue; // Try next URL (arXiv HTML)
      }

      logger.info('HTML fetch successful', {
        arxivId,
        url,
        htmlLength: html.length,
        hasContent: html.length > 500,
        source: url.includes('ar5iv') ? 'ar5iv' : 'arxiv',
      });

      return html;
    } catch (error) {
      // Handle fetch errors (network, timeout, etc.)
      logger.warn('HTML fetch error, trying next source', {
        arxivId,
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      lastError = error instanceof Error ? error : new Error(String(error));
      continue; // Try next URL
    }
  }

  // All URLs failed
  throw new Error(`All HTML sources failed for ${arxivId}: ${lastError?.message || 'Unknown error'}`);
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

  // Check if this is an abstract page (arxiv.org/abs/) rather than full HTML paper
  // Also check if this is arXiv HTML (arxiv.org/html/) which has a different structure
  const htmlLower = html.toLowerCase();
  const isArxivHtml = htmlLower.includes('arxiv.org/html/') && !htmlLower.includes('arxiv.org/abs/');
  const isAbstractPage = (htmlLower.includes('arxiv.org/abs/') ||
                        html.includes('submission history') ||
                        html.includes('Access Paper:')) && !isArxivHtml;

  // Extract title from <h1 class="ltx_title"> or <title>
  let title: string | undefined;
  const titleMatch = html.match(/<h1[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = stripHtmlTags(titleMatch[1]).trim();
  } else {
    // Try to get title from abstract page
    const abstractTitleMatch = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
    if (abstractTitleMatch) {
      title = stripHtmlTags(abstractTitleMatch[1]).replace(/^Title:\s*/i, '').trim();
    } else {
      const pageTitleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (pageTitleMatch) {
        title = pageTitleMatch[1].replace(/\s*-\s*ar5iv$/i, '').replace(/^\[.*?\]\s*/, '').trim();
      }
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
  } else if (isAbstractPage) {
    // Extract abstract from abstract page blockquote
    const abstractBlockquoteMatch = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
    if (abstractBlockquoteMatch) {
      abstract = stripHtmlTags(abstractBlockquoteMatch[1]).replace(/^Abstract:\s*/i, '').trim();
    }
  }

  // Extract sections from headings
  // Try ar5iv.labs format first (with ltx_title class)
  let sectionRegex = /<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
  let sectionMatch;
  let sectionIndex = 0;
  let foundSections = false;

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
      foundSections = true;
    }
  }

  // If no sections found with ltx_title, try regular headings in article content
  // This handles ar5iv.org format or papers that haven't been fully processed
  if (!foundSections) {
    // Find the main article content area
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                        html.match(/<div[^>]*class="[^"]*ltx_document[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                        html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

    const contentHtml = articleMatch ? articleMatch[1] : html;

    // Extract all headings that look like paper sections (not navigation/metadata)
    const headingRegex = /<(h[1-6])[^>]*(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/gi;
    const excludePatterns = [
      /^(title|abstract|submission history|access paper|references|citation|bibtex|bookmark|bibliographic|code|data|media|demos|recommenders|arxivlabs|quick links|mobilemenulabel)$/i,
      /^computer science/i,
      /^title:/i,
      /^access paper:/i,
      /^references &/i,
      /^bibliographic and citation/i,
      /^code, data and media/i,
      /^bibtex formatted citation/i,
      /^recommenders and search tools/i,
      /^arxivlabs:/i,
      /^which authors/i,
      /^disable mathjax/i,
      /^full-text links/i,
      /^current browse context/i,
      /^change to browse by/i,
      /^subjects:/i,
      /^cite as:/i,
      /^focus to learn more/i,
      /^submission history/i,
      /^from:/i,
    ];

    while ((sectionMatch = headingRegex.exec(contentHtml)) !== null) {
      const level = parseInt(sectionMatch[1].substring(1), 10);
      const id = sectionMatch[2] || `section-${sectionIndex}`;
      const sectionTitle = stripHtmlTags(sectionMatch[3]).trim();

      // Skip if it matches exclusion patterns
      if (excludePatterns.some(pattern => pattern.test(sectionTitle))) {
        continue;
      }

      if (sectionTitle && sectionTitle.length > 2 && level >= 1 && level <= 6) {
        const section: PaperSection = {
          id,
          title: sectionTitle,
          level,
        };
        sections.push(section);
        tableOfContents.push(section);
        sectionIndex++;
        foundSections = true;
      }
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

  // Handle arXiv HTML format (different from ar5iv)
  if (isArxivHtml) {
    // arXiv HTML has the paper content in <main> or <article> tags
    // Extract the main content area
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                     html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);

    if (mainMatch) {
      mainContent = mainMatch[1];
      logger.info('Extracted arXiv HTML content', { contentLength: mainContent.length });
    } else {
      // Fallback: try to find content between navigation elements
      const contentMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (contentMatch) {
        mainContent = contentMatch[1];
        // Remove navigation, header, footer
        mainContent = mainContent.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
        mainContent = mainContent.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
        mainContent = mainContent.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
      }
    }
  } else if (isAbstractPage) {
    // This is an abstract page, extract just the abstract and title
    logger.warn('Received abstract page instead of full paper - extracting abstract only');

    // Extract abstract from blockquote (already extracted above, but ensure we have it)
    if (!abstract) {
      const abstractBlockquoteMatch = html.match(/<blockquote[^>]*class="[^"]*abstract[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/i);
      if (abstractBlockquoteMatch) {
        abstract = stripHtmlTags(abstractBlockquoteMatch[1]).replace(/^Abstract:\s*/i, '').trim();
      }
    }

    // Extract arXiv ID from URL or HTML for the link
    const arxivIdMatch = html.match(/arxiv\.org\/(?:abs|html)\/(\d{4}\.\d{4,5})/i) ||
                        html.match(/citation_arxiv_id["\s]*content=["'](\d{4}\.\d{4,5})/i);
    const arxivIdForLink = arxivIdMatch ? arxivIdMatch[1] : '';

    // Create a minimal content with just abstract
    mainContent = `
      <div class="paper-reader-content paper-reader-abstract-only">
        ${title ? `<h1 class="paper-title">${escapeHtml(title)}</h1>` : ''}
        <section id="abstract" class="paper-section">
          <h2>Abstract</h2>
          <p>${escapeHtml(abstract || 'Abstract not available')}</p>
        </section>
        <div class="paper-notice">
          <p>Full HTML paper is not yet available on ar5iv. This paper may be too recent or not yet processed.</p>
          ${arxivIdForLink ? `<p><a href="https://arxiv.org/abs/${arxivIdForLink}" target="_blank" rel="noopener">View on arXiv</a> for the complete paper.</p>` : ''}
        </div>
      </div>
    `;

    // Add abstract as the only section
    if (abstract) {
      sections.push({
        id: 'abstract',
        title: 'Abstract',
        level: 2,
      });
      tableOfContents.push({
        id: 'abstract',
        title: 'Abstract',
        level: 2,
      });
    }
  } else {
    // Try to find the main article body (full paper)
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
  }

  // Clean up the HTML (only if not already processed abstract page)
  if (!isAbstractPage) {
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
    mainContent = wrappedHtml.trim();
  } else {
    // Abstract page content is already wrapped
    mainContent = mainContent.trim();
  }

  return {
    source: isAbstractPage ? 'abstract' : (isArxivHtml ? 'arxiv' : 'ar5iv'),
    html: mainContent,
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
  if (!text) return '';
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
      logger.info('Attempting ar5iv fetch', {
        bibcode,
        arxivId,
        hasAdsBody: !!options.adsBody,
        hasAbstract: !!options.abstract,
      });

      const html = await fetchAr5ivHtml(arxivId);
      const parsed = parseAr5ivHtml(html);

      // Verify we got meaningful content
      // Allow papers with good HTML content even if sections aren't extracted
      // (some papers may not have clear section structure)
      if (parsed.html.length > 500) {
        logger.info('ar5iv fetch successful', {
          bibcode,
          arxivId,
          contentLength: parsed.html.length,
          sectionsCount: parsed.sections.length,
          figuresCount: parsed.figures.length,
        });
        return parsed;
      }

      logger.warn('ar5iv returned minimal content, falling back', {
        bibcode,
        arxivId,
        htmlLength: parsed.html.length,
        sectionsCount: parsed.sections.length,
      });
    } catch (error) {
      logger.warn('ar5iv fetch failed, falling back', {
        bibcode,
        arxivId,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        hasAdsBody: !!options.adsBody,
        hasAbstract: !!options.abstract,
      });
    }
  } else {
    logger.info('No arXiv ID found, skipping ar5iv', { bibcode });
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
