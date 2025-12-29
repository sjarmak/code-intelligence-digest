import { NextRequest, NextResponse } from 'next/server';
import { searchPapers, getPaper, getLibraryPapers, storePapersBatch, linkPapersToLibraryBatch, initializeADSTables } from '@/src/lib/db/ads-papers';
import type { ADSPaperRecord } from '@/src/lib/db/ads-papers';
import { logger } from '@/src/lib/logger';
import { getADSUrl, getArxivUrl, getLibraryItems, getBibcodeMetadata } from '@/src/lib/ads/client';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AskRequest {
  question: string;
  libraryId?: string; // Deprecated: use libraryIds instead
  libraryIds?: string[]; // Array of library IDs
  selectedBibcodes?: string[]; // Papers selected by user
  limit?: number;
  conversationHistory?: ConversationMessage[]; // For follow-up questions
  papersContext?: string; // Pre-computed papers context from initial query (for follow-ups)
}

export async function POST(request: NextRequest) {
  try {
    // Check rate limits
    const { enforceRateLimit, recordUsage } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/papers/ask');
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const {
      question,
      limit = 20,
      libraryId, // Deprecated, kept for backward compatibility
      libraryIds,
      selectedBibcodes,
      conversationHistory,
      papersContext
    } = (await request.json()) as AskRequest;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    if (!openaiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured in .env.local' },
        { status: 500 }
      );
    }

    if (!openaiKey.startsWith('sk-')) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY format is invalid. Must start with "sk-".' },
        { status: 500 }
      );
    }

    const isFollowUp = !!conversationHistory && conversationHistory.length > 0;
    // Support both old libraryId and new libraryIds
    const effectiveLibraryIds = libraryIds || (libraryId ? [libraryId] : []);

    logger.info('Processing question', {
      question,
      hasSelectedPapers: !!selectedBibcodes?.length,
      hasLibraries: effectiveLibraryIds.length > 0,
      libraryCount: effectiveLibraryIds.length,
      isFollowUp
    });

    let papers: ADSPaperRecord[] = [];
    let context: string;

    // For follow-up questions, reuse papers context
    if (isFollowUp && papersContext) {
      logger.info('Using existing papers context for follow-up');
      context = papersContext;
      // Extract bibcodes from context for citation tracking
      papers = selectedBibcodes?.length
        ? (await Promise.all(selectedBibcodes.map((bibcode: string) => getPaper(bibcode))))
            .filter((p): p is ADSPaperRecord => p !== null)
        : [];
    } else {
      // Initial query: fetch papers
      if (selectedBibcodes && selectedBibcodes.length > 0) {
        // Use user-selected papers
        logger.info('Using selected papers', { count: selectedBibcodes.length });
        papers = (await Promise.all(selectedBibcodes.map((bibcode: string) => getPaper(bibcode))))
          .filter((p): p is ADSPaperRecord => p !== null);
      } else if (effectiveLibraryIds.length > 0) {
        // Use papers from selected libraries
        logger.info('Fetching papers from libraries', { libraryIds: effectiveLibraryIds, limit });
        const allPapers: ADSPaperRecord[] = [];
        const token = process.env.ADS_API_TOKEN;

        for (const libId of effectiveLibraryIds) {
          // First try to get papers from database
          let libPapers = getLibraryPapers(libId, limit);

          // If no papers in database, fetch from ADS API
          if (libPapers.length === 0 && token) {
            try {
              logger.info(`No papers in database for library ${libId}, fetching from ADS API`);
              const bibcodes = await getLibraryItems(libId, token, { start: 0, rows: limit });

              if (bibcodes.length > 0) {
                // Fetch metadata and store papers
                const metadata = await getBibcodeMetadata(bibcodes, token);

                // Initialize tables if needed
                try {
                  initializeADSTables();
                } catch {
                  // Tables may already exist
                }

                // Store papers
                const papersToStore = bibcodes
                  .map((bibcode) => ({
                    bibcode,
                    title: metadata[bibcode]?.title,
                    authors: metadata[bibcode]?.authors
                      ? JSON.stringify(metadata[bibcode].authors)
                      : undefined,
                    pubdate: metadata[bibcode]?.pubdate,
                    abstract: metadata[bibcode]?.abstract,
                    body: metadata[bibcode]?.body,
                    adsUrl: getADSUrl(bibcode),
                    arxivUrl: getArxivUrl(bibcode),
                    fulltextSource: metadata[bibcode]?.body ? 'ads_api' : undefined,
                  }))
                  .filter(
                    (p) =>
                      p.title ||
                      p.authors ||
                      p.pubdate ||
                      p.abstract ||
                      p.body,
                  );

                if (papersToStore.length > 0) {
                  await storePapersBatch(papersToStore);
                  linkPapersToLibraryBatch(libId, bibcodes);
                  logger.info(`Stored ${papersToStore.length} papers from library ${libId}`);
                }

                // Now get papers from database
                libPapers = getLibraryPapers(libId, limit);
              }
            } catch (error) {
              logger.error(`Failed to fetch papers from ADS API for library ${libId}`, {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Deduplicate by bibcode
          for (const paper of libPapers) {
            if (!allPapers.some(p => p.bibcode === paper.bibcode)) {
              allPapers.push(paper);
            }
          }
        }
        papers = allPapers.slice(0, limit); // Limit total papers
        logger.info(`Found ${papers.length} unique papers from ${effectiveLibraryIds.length} libraries`);
      } else {
        // Fall back to search all cached papers
        logger.info('Searching all papers', { question });
        papers = searchPapers(question, limit);
      }

      if (papers.length === 0) {
        let errorMessage = 'No papers found matching your query.';
        if (effectiveLibraryIds.length > 0) {
          errorMessage = `No papers found in the selected ${effectiveLibraryIds.length > 1 ? 'libraries' : 'library'}. The library may be empty, or papers may need to be fetched first. Try expanding the library in the libraries view to load papers.`;
        } else if (selectedBibcodes && selectedBibcodes.length > 0) {
          errorMessage = 'None of the selected papers were found in the database.';
        }
        return NextResponse.json(
          { answer: errorMessage },
          { status: 200 }
        );
      }

      // Prepare context from papers with bibcodes for citation
      // Use section-based retrieval when available for better relevance
      const { buildSectionContext } = await import('@/src/lib/pipeline/section-summarization');
      const { initializePaperSectionsTable, getSectionSummaries } = await import('@/src/lib/db/paper-sections');

      // Ensure sections table exists
      try {
        initializePaperSectionsTable();
      } catch (error) {
        logger.warn('Paper sections table initialization failed', { error });
      }

      const contextParts = await Promise.all(
        papers
          .slice(0, 10) // Limit to top 10 papers to avoid token overflow
          .map(async (p, idx) => {
            let authorStr = 'Unknown';
            if (p.authors) {
              try {
                const parsedAuthors = JSON.parse(p.authors);
                if (Array.isArray(parsedAuthors)) {
                  authorStr = parsedAuthors.slice(0, 3).join(', ');
                  if (parsedAuthors.length > 3) authorStr += ' et al.';
                } else {
                  authorStr = p.authors;
                }
              } catch {
                authorStr = p.authors;
              }
            }

            // Try to use section-based context if sections are available
            const sections = await getSectionSummaries(p.bibcode);
            let paperContext: string;

            if (sections.length > 0) {
              // Use section-based retrieval
              try {
                const sectionContext = await buildSectionContext(
                  p.bibcode,
                  question,
                  {
                    maxSections: 5,
                    includeFullText: true,
                    maxFullTextLength: 5000,
                  }
                );

                paperContext = `[${idx + 1}] Bibcode: ${p.bibcode}\nTitle: ${p.title || p.bibcode}\nAuthors: ${authorStr}\nAbstract: ${p.abstract || 'N/A'}\n\nRelevant Sections:\n${sectionContext}`;
              } catch (error) {
                logger.warn('Failed to build section context, falling back to full text', {
                  bibcode: p.bibcode,
                  error: error instanceof Error ? error.message : String(error),
                });
                // Fall through to full text approach
                paperContext = buildFullTextContext(p, idx, authorStr);
              }
            } else {
              // Fallback: use full text (truncated) if sections aren't available
              paperContext = buildFullTextContext(p, idx, authorStr);
            }

            return paperContext;
          })
      );

      context = contextParts.join('\n\n---\n\n');

      // Helper function to build context from full text
      function buildFullTextContext(p: ADSPaperRecord, idx: number, authorStr: string): string {
        let bodyText = '';
        if (p.body && p.body.length > 0) {
          // Truncate body to ~20K chars per paper when not using sections
          // (smaller since we're including multiple papers)
          const maxBodyLength = 20000;
          bodyText = p.body.length > maxBodyLength
            ? p.body.substring(0, maxBodyLength) + '\n[... content truncated ...]'
            : p.body;
        }

        return `[${idx + 1}] Bibcode: ${p.bibcode}\nTitle: ${p.title || p.bibcode}\nAuthors: ${authorStr}\nAbstract: ${p.abstract || 'N/A'}${bodyText ? `\n\nFull Text:\n${bodyText}` : ''}`;
      }
    }

    logger.info('Generating answer from papers', {
      papersCount: papers.length,
      contextLength: context.length,
      papersWithBody: papers.filter(p => p.body && p.body.length > 0).length,
      isFollowUp,
    });

    // Build messages array: system prompt + conversation history + current question
    const systemPrompt = `You are an expert research analyst specializing in synthesizing academic papers. When answering questions:
1. Provide concise, evidence-based answers (2-4 paragraphs for initial questions, shorter for follow-ups)
2. Quote specific relevant excerpts from the papers
3. For each quote or key finding, cite the paper using [N] format where N is the paper index
4. Highlight the most relevant papers for this specific question
5. If papers conflict or differ in findings, note those differences
6. Always ground your answer in the actual paper content provided
7. For follow-up questions, stay focused and avoid repeating prior answers unless asked

Papers context:
${context}`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history if this is a follow-up
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Add current question
    const userContent = isFollowUp
      ? question
      : `Based on the following academic papers, answer this question: "${question}"\n\nProvide an evidence-based answer with specific citations [N] for each key claim. Include direct quotes where relevant to support your synthesis.`;

    messages.push({ role: 'user', content: userContent });

    // Generate answer using GPT-4o
    const message = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages,
    });

    const answer = message.choices[0]?.message?.content || 'Failed to generate answer';

    logger.info('Question answered', { answerLength: answer.length });

    // Parse citation references from answer and map to paper URLs
    const citedIndices = new Set<number>();
    const citationRegex = /\[(\d+)\]/g;
    let match;
    while ((match = citationRegex.exec(answer)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < papers.length) {
        citedIndices.add(idx);
      }
    }

    return NextResponse.json({
      answer,
      papersUsed: papers.length,
      papersContext: context, // Return context for follow-up conversations
      citedPapers: Array.from(citedIndices)
        .map((idx) => {
          const p = papers[idx];
          if (!p) return null;

          let authorStr = 'Unknown';
          if (p.authors) {
            try {
              const parsedAuthors = JSON.parse(p.authors);
              if (Array.isArray(parsedAuthors)) {
                authorStr = parsedAuthors.slice(0, 3).join(', ');
                if (parsedAuthors.length > 3) authorStr += ' et al.';
              }
            } catch {
              authorStr = p.authors;
            }
          }
          return {
            index: idx + 1,
            bibcode: p.bibcode,
            title: p.title,
            authors: authorStr,
            adsUrl: p.adsUrl || getADSUrl(p.bibcode),
          };
        })
        .filter((p): p is Exclude<typeof p, null> => p !== null),
      allPapers: papers
        .slice(0, 5)
        .map((p) => {
          let authorStr = 'Unknown';
          if (p.authors) {
            try {
              const parsedAuthors = JSON.parse(p.authors);
              if (Array.isArray(parsedAuthors)) {
                authorStr = parsedAuthors.slice(0, 3).join(', ');
              }
            } catch {
              authorStr = p.authors;
            }
          }
          return {
            bibcode: p.bibcode,
            title: p.title,
            authors: authorStr,
            adsUrl: p.adsUrl || getADSUrl(p.bibcode),
          };
        }),
    });

    // Record successful usage
    await recordUsage(request, '/api/papers/ask');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to answer question', { error: errorMsg });

    // Check for common OpenAI API errors
    if (errorMsg.includes('401') || errorMsg.includes('Incorrect API key')) {
      return NextResponse.json(
        { error: 'OpenAI API key is invalid or expired. Check OPENAI_API_KEY in .env.local' },
        { status: 500 }
      );
    }

    if (errorMsg.includes('429')) {
      return NextResponse.json(
        { error: 'OpenAI API rate limit exceeded. Please try again in a few moments.' },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate answer' },
      { status: 500 }
    );
  }
}
