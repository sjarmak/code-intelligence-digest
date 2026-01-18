import { NextRequest, NextResponse } from 'next/server';
import { searchPapers, getPaper, getLibraryPapers, storePapersBatch, linkPapersToLibraryBatch, initializeADSTables } from '@/src/lib/db/ads-papers';
import type { ADSPaperRecord } from '@/src/lib/db/ads-papers';
import { getSavedItems } from '@/src/lib/db/savedItems';
import { getDigestItems } from '@/src/lib/db/digestItems';
import { loadItem } from '@/src/lib/db/items';
import { generateAnswer } from '@/src/lib/pipeline/answer';
import { retrieveRelevantItems } from '@/src/lib/pipeline/retrieval';
import { logger } from '@/src/lib/logger';
import { getADSUrl, getLibraryItems } from '@/src/lib/ads/client';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ResourcesAskRequest {
  question: string;
  libraryId?: string; // Deprecated: use libraryIds instead
  libraryIds?: string[]; // Array of research library IDs
  resourceLibraryIds?: string[]; // Array of resource library IDs ('saved-items' | 'digest-items')
  selectedBibcodes?: string[]; // Papers selected by user
  selectedItemIds?: string[]; // Items selected by user
  limit?: number;
  conversationHistory?: ConversationMessage[]; // For follow-up questions
  papersContext?: string; // Pre-computed papers context from initial query (for follow-ups)
  itemsContext?: string; // Pre-computed items context from initial query (for follow-ups)
}

interface ResourcesAskResponse {
  answer: string;
  sourcesUsed: number;
  papersUsed?: number;
  itemsUsed?: number;
  papersContext?: string;
  itemsContext?: string;
  citedPapers?: Array<{
    index: number;
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
  citedItems?: Array<{
    index: number;
    id: string;
    title?: string;
    url?: string;
    sourceTitle?: string;
  }>;
  allPapers?: Array<{
    bibcode: string;
    title?: string;
    authors?: string;
    adsUrl?: string;
  }>;
  allItems?: Array<{
    id: string;
    title?: string;
    url?: string;
    sourceTitle?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    // Check rate limits
    const { enforceRateLimit, recordUsage } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/resources/ask');
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const {
      question,
      limit = 20,
      libraryId, // Deprecated, kept for backward compatibility
      libraryIds,
      resourceLibraryIds,
      selectedBibcodes,
      selectedItemIds,
      conversationHistory,
      papersContext,
      itemsContext
    } = (await request.json()) as ResourcesAskRequest;
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

    logger.info('Processing question with resources', {
      question,
      hasSelectedPapers: !!selectedBibcodes?.length,
      hasSelectedItems: !!selectedItemIds?.length,
      hasResearchLibraries: effectiveLibraryIds.length > 0,
      hasResourceLibraries: !!resourceLibraryIds?.length,
      isFollowUp
    });

    let papers: ADSPaperRecord[] = [];
    let items: Array<{ id: string; title: string; url: string; sourceTitle: string; summary?: string; contentSnippet?: string; fullText?: string; category?: string; publishedAt: Date }> = [];
    let papersContextString: string = '';
    let itemsContextString: string = '';

    // For follow-up questions, reuse context
    if (isFollowUp && papersContext) {
      logger.info('Using existing papers context for follow-up');
      papersContextString = papersContext;
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
        // Use papers from selected research libraries
        logger.info('Fetching papers from research libraries', { libraryIds: effectiveLibraryIds, limit });
        const allPapers: ADSPaperRecord[] = [];
        const token = process.env.ADS_API_TOKEN;

        for (const libId of effectiveLibraryIds) {
          // First try to get papers from database
          let libPapers = await getLibraryPapers(libId, limit);

          // If no papers in database, fetch from ADS API
          if (libPapers.length === 0 && token) {
            try {
              logger.info(`No papers in database for library ${libId}, fetching from ADS API`);
              const libraryBibcodes = await getLibraryItems(libId, token, { rows: limit });
              if (libraryBibcodes.length > 0) {
                // Fetch paper metadata and store
                const { getBibcodeMetadata, getADSUrl } = await import('@/src/lib/ads/client');
                const metadataMap = await getBibcodeMetadata(libraryBibcodes, token);
                const papersToStore = libraryBibcodes
                  .filter(bibcode => metadataMap[bibcode])
                  .map(bibcode => {
                    const meta = metadataMap[bibcode];
                    return {
                      bibcode,
                      title: meta.title,
                      authors: JSON.stringify(meta.authors || []),
                      abstract: meta.abstract,
                      body: meta.body,
                      adsUrl: getADSUrl(bibcode),
                    };
                  });
                await storePapersBatch(papersToStore);
                await linkPapersToLibraryBatch(libId, libraryBibcodes);
                libPapers = await getLibraryPapers(libId, limit);
              }
            } catch (error) {
              logger.warn(`Failed to fetch library ${libId} from ADS API`, { error });
            }
          }

          allPapers.push(...libPapers);
        }

        papers = allPapers;
      }
    }

    // Handle items (from resource libraries or selected items)
    if (isFollowUp && itemsContext) {
      logger.info('Using existing items context for follow-up');
      itemsContextString = itemsContext;
      // Load items for citation tracking
      if (selectedItemIds?.length) {
        for (const itemId of selectedItemIds) {
          const item = await loadItem(itemId);
          if (item) {
            items.push({
              id: item.id,
              title: item.title,
              url: item.url,
              sourceTitle: item.sourceTitle,
              summary: item.summary,
              contentSnippet: item.contentSnippet,
              fullText: item.fullText,
              category: item.category,
              publishedAt: item.publishedAt,
            });
          }
        }
      }
    } else {
      // Initial query: fetch items
      if (selectedItemIds && selectedItemIds.length > 0) {
        // Use user-selected items
        logger.info('Using selected items', { count: selectedItemIds.length });
        for (const itemId of selectedItemIds) {
          const item = await loadItem(itemId);
          if (item) {
            items.push({
              id: item.id,
              title: item.title,
              url: item.url,
              sourceTitle: item.sourceTitle,
              summary: item.summary,
              contentSnippet: item.contentSnippet,
              fullText: item.fullText,
              category: item.category,
              publishedAt: item.publishedAt,
            });
          }
        }
      } else if (resourceLibraryIds && resourceLibraryIds.length > 0) {
        // Use items from selected resource libraries
        logger.info('Fetching items from resource libraries', { resourceLibraryIds, limit });
        const allItems: typeof items = [];

        for (const libId of resourceLibraryIds) {
          if (libId === 'saved-items') {
            const savedItems = await getSavedItems(limit);
            for (const item of savedItems) {
              allItems.push({
                id: item.id,
                title: item.title,
                url: item.url,
                sourceTitle: item.sourceTitle,
                summary: item.summary,
                contentSnippet: item.contentSnippet,
                fullText: item.fullText,
                category: item.category,
                publishedAt: item.publishedAt,
              });
            }
          } else if (libId === 'digest-items') {
            const digestItems = await getDigestItems(limit);
            for (const item of digestItems) {
              allItems.push({
                id: item.id,
                title: item.title,
                url: item.url,
                sourceTitle: item.sourceTitle,
                summary: item.summary,
                contentSnippet: item.contentSnippet,
                fullText: item.fullText,
                category: item.category,
                publishedAt: item.publishedAt,
              });
            }
          }
        }

        items = allItems;
      }
    }

    // Build context from papers
    if (papers.length > 0 && !papersContextString) {
      // Initialize ADS tables if needed
      try {
        await initializeADSTables();
      } catch (error) {
        logger.warn('ADS tables initialization failed', { error });
      }

      const contextParts = await Promise.all(
        papers
          .slice(0, 10) // Limit to top 10 papers
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

            let bodyText = '';
            if (p.body && p.body.length > 0) {
              const maxBodyLength = 20000;
              bodyText = p.body.length > maxBodyLength
                ? p.body.substring(0, maxBodyLength) + '\n[... content truncated ...]'
                : p.body;
            }

            return `[Paper ${idx + 1}] Bibcode: ${p.bibcode}\nTitle: ${p.title || p.bibcode}\nAuthors: ${authorStr}\nAbstract: ${p.abstract || 'N/A'}${bodyText ? `\n\nFull Text:\n${bodyText}` : ''}`;
          })
      );

      papersContextString = contextParts.join('\n\n---\n\n');
    }

    // Build context from items
    if (items.length > 0 && !itemsContextString) {
      const itemContextParts = items
        .slice(0, 10) // Limit to top 10 items
        .map((item, idx) => {
          const content = item.fullText || item.summary || item.contentSnippet || 'No content available';
          const truncatedContent = content.length > 2000
            ? content.substring(0, 2000) + '...'
            : content;

          return `[Item ${idx + 1}] Title: ${item.title}\nSource: ${item.sourceTitle}\nURL: ${item.url}\nCategory: ${item.category || 'N/A'}\nPublished: ${item.publishedAt.toLocaleDateString()}\n\nContent:\n${truncatedContent}`;
        });

      itemsContextString = itemContextParts.join('\n\n---\n\n');
    }

    // Combine contexts
    const combinedContext = [
      papersContextString ? `RESEARCH PAPERS:\n${papersContextString}` : '',
      itemsContextString ? `RESOURCES:\n${itemsContextString}` : '',
    ]
      .filter(Boolean)
      .join('\n\n==========\n\n');

    if (!combinedContext) {
      return NextResponse.json(
        { error: 'No papers or items available to answer the question' },
        { status: 400 }
      );
    }

    logger.info('Generating answer from resources', {
      papersCount: papers.length,
      itemsCount: items.length,
      contextLength: combinedContext.length,
      isFollowUp,
    });

    // Build messages array
    const systemPrompt = `You are an expert research analyst specializing in synthesizing information from academic papers and resources. When answering questions:
1. Provide concise, evidence-based answers (2-4 paragraphs for initial questions, shorter for follow-ups)
2. Quote specific relevant excerpts from the sources
3. For each quote or key finding, cite the source using [Paper N] or [Item N] format where N is the source index
4. Highlight the most relevant sources for this specific question
5. If sources conflict or differ in findings, note those differences
6. Always ground your answer in the actual content provided
7. For follow-up questions, stay focused and avoid repeating prior answers unless asked

Sources context:
${combinedContext}`;

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
      : `Based on the following research papers and resources, answer this question: "${question}"\n\nProvide an evidence-based answer with specific citations [Paper N] or [Item N] for each key claim. Include direct quotes where relevant to support your synthesis.`;

    messages.push({ role: 'user', content: userContent });

    // Generate answer using GPT-4o-mini
    const message = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages,
    });

    const answer = message.choices[0]?.message?.content || 'Failed to generate answer';

    logger.info('Question answered', { answerLength: answer.length });

    // Parse citation references from answer
    const citedPaperIndices = new Set<number>();
    const citedItemIndices = new Set<number>();
    const paperCitationRegex = /\[Paper\s+(\d+)\]/gi;
    const itemCitationRegex = /\[Item\s+(\d+)\]/gi;

    let match;
    while ((match = paperCitationRegex.exec(answer)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < papers.length) {
        citedPaperIndices.add(idx);
      }
    }

    while ((match = itemCitationRegex.exec(answer)) !== null) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < items.length) {
        citedItemIndices.add(idx);
      }
    }

    // Build cited papers
    const citedPapers = Array.from(citedPaperIndices)
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
      .filter((p): p is Exclude<typeof p, null> => p !== null);

    // Build cited items
    const citedItems = Array.from(citedItemIndices)
      .map((idx) => {
        const item = items[idx];
        if (!item) return null;

        return {
          index: idx + 1,
          id: item.id,
          title: item.title,
          url: item.url,
          sourceTitle: item.sourceTitle,
        };
      })
      .filter((item): item is Exclude<typeof item, null> => item !== null);

    // Build all sources
    const allPapers = papers
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
      });

    const allItems = items
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
      }));

    // Record successful usage
    await recordUsage(request, '/api/resources/ask');

    return NextResponse.json({
      answer,
      sourcesUsed: papers.length + items.length,
      papersUsed: papers.length,
      itemsUsed: items.length,
      papersContext: papersContextString, // Return context for follow-up conversations
      itemsContext: itemsContextString, // Return context for follow-up conversations
      citedPapers,
      citedItems,
      allPapers,
      allItems,
    } as ResourcesAskResponse);
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
