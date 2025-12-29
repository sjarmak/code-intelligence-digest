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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

  // If we have section metadata from HTML parsing, use it to guide extraction
  if (sectionMetadata && sectionMetadata.length > 0) {
    // For now, create sections based on metadata
    // In a full implementation, we'd extract actual text ranges from body
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
  } else {
    // Fallback: split body into chunks by looking for common section patterns
    // This is a simplified approach - in practice, you'd want more sophisticated parsing
    const chunkSize = 5000; // ~5K chars per section
    let pos = 0;
    let sectionIndex = 0;

    while (pos < body.length) {
      const chunkEnd = Math.min(pos + chunkSize, body.length);
      const chunk = body.substring(pos, chunkEnd);

      // Try to find a natural break point (sentence end, paragraph break)
      let actualEnd = chunkEnd;
      if (chunkEnd < body.length) {
        // Look for sentence or paragraph break near the end
        const breakMatch = chunk.match(/[.!?]\s+$/);
        if (breakMatch) {
          actualEnd = pos + breakMatch.index! + breakMatch[0].length;
        }
      }

      sections.push({
        sectionId: `chunk-${sectionIndex}`,
        sectionTitle: `Section ${sectionIndex + 1}`,
        level: 2,
        fullText: body.substring(pos, actualEnd).trim(),
        charStart: pos,
        charEnd: actualEnd,
      });

      pos = actualEnd;
      sectionIndex++;
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

    const response = await openai.chat.completions.create({
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
  const paper = getPaper(bibcode);

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
  const cached = getCachedHtmlContent(bibcode);
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

