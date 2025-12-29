/**
 * Section-based summarization and retrieval for papers
 * Extracts sections from paper body, summarizes them, and enables intelligent retrieval
 */

import { getPaper } from '../db/ads-papers';
import { PaperSection } from '../ar5iv/parser';
import {
  storeSectionSummaries,
  generateAndStoreSectionEmbeddings,
  findRelevantSections,
  getSectionSummaries,
  clearSectionSummaries,
} from '../db/paper-sections';
import { logger } from '../logger';
import OpenAI from 'openai';

// Lazy initialization to avoid issues when env vars aren't loaded yet
let openaiInstance: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiInstance = new OpenAI({ apiKey });
  }
  return openaiInstance;
}

/**
 * Extract sections from paper body text
 * Uses section metadata from HTML parsing if available, otherwise infers from body structure
 */
export function extractSectionsFromBody(
  body: string,
  sectionMetadata?: PaperSection[]
): Array<{
  sectionId: string;
  sectionTitle: string;
  level: number;
  fullText: string;
  charStart: number;
  charEnd: number;
}> {
  const sections: Array<{
    sectionId: string;
    sectionTitle: string;
    level: number;
    fullText: string;
    charStart: number;
    charEnd: number;
  }> = [];

  // If we have section metadata from HTML parsing, check if it's useful
  let useMetadata = false;
  if (sectionMetadata && sectionMetadata.length > 0) {
    // Check if we have generic sections like "Abstract" and "Full Text" that need to be broken down
    const hasGenericSections = sectionMetadata.some(m =>
      m.title.toLowerCase().includes('full text') ||
      (m.title.toLowerCase() === 'abstract' && sectionMetadata.length <= 2)
    );

    // Only use metadata if we have proper sections (not just "Abstract" and "Full Text")
    useMetadata = !hasGenericSections || sectionMetadata.length > 3;
  }

  if (useMetadata && sectionMetadata) {
    // Use the metadata to guide extraction
    let currentPos = 0;
    const bodyLength = body.length;

    for (let i = 0; i < sectionMetadata.length; i++) {
      const meta = sectionMetadata[i];
      const nextMeta = sectionMetadata[i + 1];

      // Try to find section title in body text to get accurate boundaries
      let sectionStart = currentPos;
      let sectionEnd = bodyLength;

      // Search for section title in body (case-insensitive, flexible matching)
      const titleLower = meta.title.toLowerCase();
      const titleSearch = body.toLowerCase().indexOf(titleLower, currentPos);

      if (titleSearch >= currentPos) {
        sectionStart = titleSearch;
      } else {
        // If title not found, try searching for key words from title
        const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
        if (titleWords.length > 0) {
          const firstWord = titleWords[0];
          const wordSearch = body.toLowerCase().indexOf(firstWord, currentPos);
          if (wordSearch >= currentPos) {
            sectionStart = wordSearch;
          }
        }
      }

      // Find end of section (start of next section or end of body)
      if (nextMeta) {
        const nextTitleLower = nextMeta.title.toLowerCase();
        const nextTitleSearch = body.toLowerCase().indexOf(nextTitleLower, sectionStart + 1);
        if (nextTitleSearch > sectionStart) {
          sectionEnd = nextTitleSearch;
        } else {
          // Try searching for next section's key words
          const nextTitleWords = nextTitleLower.split(/\s+/).filter(w => w.length > 3);
          if (nextTitleWords.length > 0) {
            const nextFirstWord = nextTitleWords[0];
            const nextWordSearch = body.toLowerCase().indexOf(nextFirstWord, sectionStart + 1);
            if (nextWordSearch > sectionStart) {
              sectionEnd = nextWordSearch;
            }
          }
        }
      }

      if (sectionStart < bodyLength) {
        const sectionText = body.substring(
          sectionStart,
          Math.min(sectionEnd, bodyLength)
        );

        if (sectionText.trim().length > 50) {
          // Only include substantial sections
          sections.push({
            sectionId: meta.id || `section-${i}`,
            sectionTitle: meta.title,
            level: meta.level,
            fullText: sectionText.trim(),
            charStart: sectionStart,
            charEnd: Math.min(sectionEnd, bodyLength),
          });
        }
      }

      currentPos = sectionEnd;
    }
  }

  // If we don't have sections yet (or had generic ones), try extraction from body
  if (sections.length === 0) {
    // Fallback: try to extract sections from body text by looking for section patterns
    // Look for numbered sections (1. Introduction, 2. Methodology, etc.)
    // Also look for semantic section headers (Introduction, Methodology, Results, etc.)

    const sectionPatterns = [
      // Numbered sections: "1. Title", "1 Title", "Section 1: Title", etc.
      /^\s*(\d+)\.?\s+([A-Z][^\n]{2,80}?)(?:\n|$)/gm,
      // Section headers: "Section 1: Title", "Section 1 Title"
      /^\s*[Ss]ection\s+(\d+)[:.]?\s+([A-Z][^\n]{2,80}?)(?:\n|$)/gm,
      // Common academic section headers (case-insensitive)
      /^\s*([A-Z][A-Za-z\s]{3,50}?)(?:\n|$)/gm, // Any capitalized line (potential header)
    ];

    // First, try to find numbered sections
    const numberedMatches: Array<{ number: number; title: string; position: number }> = [];

    // Pattern 1: "1. Title" or "1 Title"
    const numberedPattern1 = /^\s*(\d+)\.?\s+([A-Z][^\n]{2,80}?)(?:\n|$)/gm;
    let match;
    while ((match = numberedPattern1.exec(body)) !== null) {
      const number = parseInt(match[1], 10);
      const title = match[2].trim();
      // Filter out false positives (dates, numbers that aren't section numbers)
      if (number <= 20 && title.length > 3 && !title.match(/^\d{4}/)) {
        numberedMatches.push({
          number,
          title,
          position: match.index,
        });
      }
    }

    // Pattern 2: "Section 1: Title"
    const numberedPattern2 = /^\s*[Ss]ection\s+(\d+)[:.]?\s+([A-Z][^\n]{2,80}?)(?:\n|$)/gm;
    while ((match = numberedPattern2.exec(body)) !== null) {
      const number = parseInt(match[1], 10);
      const title = match[2].trim();
      if (number <= 20 && title.length > 3) {
        numberedMatches.push({
          number,
          title,
          position: match.index,
        });
      }
    }

    // Sort by position and deduplicate
    numberedMatches.sort((a, b) => a.position - b.position);
    const uniqueMatches: typeof numberedMatches = [];
    const seenNumbers = new Set<number>();
    for (const m of numberedMatches) {
      if (!seenNumbers.has(m.number)) {
        seenNumbers.add(m.number);
        uniqueMatches.push(m);
      }
    }

    if (uniqueMatches.length >= 2) {
      // We found numbered sections! Use them
      for (let i = 0; i < uniqueMatches.length; i++) {
        const current = uniqueMatches[i];
        const next = uniqueMatches[i + 1];

        const sectionStart = current.position;
        const sectionEnd = next ? next.position : body.length;
        const sectionText = body.substring(sectionStart, sectionEnd).trim();

        // Remove the section header from the text
        const textWithoutHeader = sectionText.replace(/^\s*\d+\.?\s+[^\n]+\n?/m, '').trim();

        if (textWithoutHeader.length > 100) {
          sections.push({
            sectionId: `section-${current.number}`,
            sectionTitle: current.title,
            level: 1,
            fullText: textWithoutHeader,
            charStart: sectionStart,
            charEnd: sectionEnd,
          });
        }
      }
    } else {
      // No numbered sections found, try semantic section detection
      const semanticSections = [
        { pattern: /^\s*(Abstract|Summary)\s*$/gmi, title: 'Abstract', level: 1 },
        { pattern: /^\s*(Introduction|Background|Motivation)\s*$/gmi, title: 'Introduction', level: 1 },
        { pattern: /^\s*(Related\s+Work|Literature\s+Review|Previous\s+Work|Background)\s*$/gmi, title: 'Related Work', level: 1 },
        { pattern: /^\s*(Methodology|Methods|Approach|Method)\s*$/gmi, title: 'Methodology', level: 1 },
        { pattern: /^\s*(Implementation|System\s+Design|Architecture)\s*$/gmi, title: 'Implementation', level: 1 },
        { pattern: /^\s*(Results|Evaluation|Experiments|Experimental\s+Results)\s*$/gmi, title: 'Results', level: 1 },
        { pattern: /^\s*(Discussion|Analysis)\s*$/gmi, title: 'Discussion', level: 1 },
        { pattern: /^\s*(Conclusion|Conclusions|Summary|Future\s+Work)\s*$/gmi, title: 'Conclusion', level: 1 },
        { pattern: /^\s*(References|Bibliography)\s*$/gmi, title: 'References', level: 1 },
      ];

      const foundSections: Array<{ title: string; level: number; position: number }> = [];

      for (const semantic of semanticSections) {
        semantic.pattern.lastIndex = 0; // Reset regex
        while ((match = semantic.pattern.exec(body)) !== null) {
          // Check if this looks like a section header (not just text in a sentence)
          const before = body.substring(Math.max(0, match.index - 50), match.index);
          const after = body.substring(match.index + match[0].length, Math.min(body.length, match.index + match[0].length + 50));

          // Section headers are usually on their own line, possibly with numbers or formatting
          if (before.match(/\n\s*$/) || before.match(/^\s*$/) || before.match(/\d+\.?\s*$/)) {
            foundSections.push({
              title: semantic.title,
              level: semantic.level,
              position: match.index,
            });
          }
        }
      }

      // Sort by position and deduplicate
      foundSections.sort((a, b) => a.position - b.position);
      const uniqueSemantic: typeof foundSections = [];
      const seenTitles = new Set<string>();
      for (const s of foundSections) {
        if (!seenTitles.has(s.title) || uniqueSemantic.length === 0) {
          seenTitles.add(s.title);
          uniqueSemantic.push(s);
        }
      }

      if (uniqueSemantic.length >= 2) {
        // Use semantic sections
        for (let i = 0; i < uniqueSemantic.length; i++) {
          const current = uniqueSemantic[i];
          const next = uniqueSemantic[i + 1];

          const sectionStart = current.position;
          const sectionEnd = next ? next.position : body.length;
          const sectionText = body.substring(sectionStart, sectionEnd).trim();

          if (sectionText.length > 100) {
            sections.push({
              sectionId: `section-${i}`,
              sectionTitle: current.title,
              level: current.level,
              fullText: sectionText,
              charStart: sectionStart,
              charEnd: sectionEnd,
            });
          }
        }
      } else {
        // Last resort: split into reasonable chunks, but try to find natural breaks
        const chunkSize = 5000; // ~5K chars per section
        let pos = 0;
        let sectionIndex = 0;

        while (pos < body.length) {
          const chunkEnd = Math.min(pos + chunkSize, body.length);
          const chunk = body.substring(pos, chunkEnd);

          // Try to find a natural break point (paragraph break, sentence end)
          let actualEnd = chunkEnd;
          if (chunkEnd < body.length) {
            // Look for paragraph break first (double newline)
            const paraBreak = chunk.lastIndexOf('\n\n');
            if (paraBreak > chunk.length * 0.7) {
              actualEnd = pos + paraBreak + 2;
            } else {
              // Look for sentence end near the end
              const sentenceBreak = chunk.match(/[.!?]\s+[A-Z][^.!?]{50,}$/);
              if (sentenceBreak && sentenceBreak.index && sentenceBreak.index > chunk.length * 0.7) {
                actualEnd = pos + sentenceBreak.index + sentenceBreak[0].length;
              }
            }
          }

          const sectionText = body.substring(pos, actualEnd).trim();
          if (sectionText.length > 100) {
            sections.push({
              sectionId: `chunk-${sectionIndex}`,
              sectionTitle: sectionIndex === 0 ? 'Abstract' : sectionIndex === 1 ? 'Introduction' : `Section ${sectionIndex + 1}`,
              level: sectionIndex === 0 ? 1 : 2,
              fullText: sectionText,
              charStart: pos,
              charEnd: actualEnd,
            });
            sectionIndex++;
          }

          pos = actualEnd;
        }
      }
    }
  }

  return sections;
}

/**
 * Summarize a section using LLM
 */
async function summarizeSection(
  sectionTitle: string,
  sectionText: string
): Promise<string> {
  try {
    const prompt = `You are summarizing a section from an academic paper.

Section Title: ${sectionTitle}

Section Content:
${sectionText.substring(0, 8000)}${sectionText.length > 8000 ? '...' : ''}

Provide a concise summary (2-4 sentences) that captures:
1. The main topic or question addressed
2. Key findings, methods, or conclusions
3. Why this matters in the context of the paper

Summary:`;

    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at summarizing academic paper sections concisely and accurately.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 200,
    });

    const summary = response.choices[0]?.message?.content?.trim() || '';
    return summary || `${sectionTitle}: [Content available]`;
  } catch (error) {
    logger.error('Failed to summarize section', {
      sectionTitle,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fallback: return a simple description
    return `${sectionTitle}: ${sectionText.substring(0, 200)}...`;
  }
}

/**
 * Process a paper: extract sections, summarize them, and store with embeddings
 */
export async function processPaperSections(bibcode: string, forceRegenerate: boolean = false): Promise<void> {
  const paper = await getPaper(bibcode);

  if (!paper || !paper.body || paper.body.length < 100) {
    logger.warn('Paper has no body text to process', { bibcode });
    return;
  }

  // Check if sections already exist
  const existingSections = await getSectionSummaries(bibcode);
  if (existingSections.length > 0 && !forceRegenerate) {
    logger.info('Section summaries already exist, skipping regeneration', {
      bibcode,
      existingCount: existingSections.length,
    });

    // Only regenerate embeddings if they're missing
    const sectionsWithoutEmbeddings = existingSections.filter(s => !s.embedding || s.embedding.length === 0);
    if (sectionsWithoutEmbeddings.length > 0) {
      logger.info('Regenerating missing embeddings', {
        bibcode,
        missingCount: sectionsWithoutEmbeddings.length,
      });
      await generateAndStoreSectionEmbeddings(bibcode);
    }
    return;
  }

  logger.info('Processing paper sections', {
    bibcode,
    bodyLength: paper.body.length,
    forceRegenerate,
  });

  // Get section metadata from cached HTML if available
  const { getCachedHtmlContent } = await import('../db/paper-annotations');
  const cached = await getCachedHtmlContent(bibcode);
  let sectionMetadata = cached?.sections;

  // If no sections in cache, try to parse from HTML if available
  if ((!sectionMetadata || sectionMetadata.length === 0) && cached?.htmlContent) {
    try {
      const { parseAr5ivHtml } = await import('../ar5iv/parser');
      const parsed = parseAr5ivHtml(cached.htmlContent);
      if (parsed.sections && parsed.sections.length > 0) {
        sectionMetadata = parsed.sections;
        logger.info('Extracted sections from cached HTML', {
          bibcode,
          sectionCount: sectionMetadata.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to parse sections from cached HTML', {
        bibcode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Extract sections from body
  const sections = extractSectionsFromBody(paper.body, sectionMetadata);

  if (sections.length === 0) {
    logger.warn('No sections extracted from paper body', { bibcode });
    return;
  }

  logger.info('Extracted sections, generating summaries', {
    bibcode,
    sectionCount: sections.length,
  });

  // Summarize each section
  const sectionSummaries = await Promise.all(
    sections.map(async (section) => {
      const summary = await summarizeSection(
        section.sectionTitle,
        section.fullText
      );

      return {
        sectionId: section.sectionId,
        sectionTitle: section.sectionTitle,
        level: section.level,
        summary,
        fullText: section.fullText,
        charStart: section.charStart,
        charEnd: section.charEnd,
      };
    })
  );

  // Store summaries
  await storeSectionSummaries(bibcode, sectionSummaries);

  // Generate and store embeddings
  await generateAndStoreSectionEmbeddings(bibcode);

  logger.info('Completed section processing', {
    bibcode,
    sectionCount: sectionSummaries.length,
  });
}

/**
 * Build context from relevant sections for a question
 * Returns a formatted string with section summaries and full text for top sections
 */
export async function buildSectionContext(
  bibcode: string,
  question: string,
  options: {
    maxSections?: number; // Max sections to include (default: 5)
    includeFullText?: boolean; // Include full text for top sections (default: true for top 2)
    maxFullTextLength?: number; // Max chars of full text per section (default: 5000)
  } = {}
): Promise<string> {
  const {
    maxSections = 5,
    includeFullText = true,
    maxFullTextLength = 5000,
  } = options;

  // Find relevant sections
  const relevantSections = await findRelevantSections(
    bibcode,
    question,
    maxSections
  );

  if (relevantSections.length === 0) {
    // Fallback: get all sections if semantic search fails
    const allSections = await getSectionSummaries(bibcode);
    if (allSections.length === 0) {
      return '';
    }
    // Use first few sections as fallback
    return allSections
      .slice(0, maxSections)
      .map(
        (s, idx) =>
          `[Section ${idx + 1}] ${s.sectionTitle}\nSummary: ${s.summary}`
      )
      .join('\n\n');
  }

  // Build context string
  const contextParts = relevantSections.map((section, idx) => {
    let sectionContext = `[Section ${idx + 1}] ${section.sectionTitle} (Relevance: ${(section.relevanceScore * 100).toFixed(1)}%)\nSummary: ${section.summary}`;

    // Include full text for top sections if requested
    if (includeFullText && idx < 2 && section.fullText) {
      const fullText = section.fullText.length > maxFullTextLength
        ? section.fullText.substring(0, maxFullTextLength) + '\n[... truncated ...]'
        : section.fullText;
      sectionContext += `\n\nFull Text:\n${fullText}`;
    }

    return sectionContext;
  });

  return contextParts.join('\n\n---\n\n');
}

