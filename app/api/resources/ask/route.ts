import { NextRequest, NextResponse } from 'next/server';
import { auth } from "@/src/auth";
import { getPaper, getLibraryPapers, getFavoritePapers, storePapersBatch, linkPapersToLibraryBatch, initializeADSTables } from '@/src/lib/db/ads-papers';
import type { ADSPaperRecord } from '@/src/lib/db/ads-papers';
import { getSavedItems, LEGACY_USER_ID } from '@/src/lib/db/savedItems';
import { getDigestItems } from '@/src/lib/db/digestItems';
import { loadItem, saveFullText } from '@/src/lib/db/items';
import { initializeDatabase } from '@/src/lib/db/index';
import { getGeneratedNewsletter, listGeneratedNewsletters } from '@/src/lib/db/generated-newsletters';
import { listUserPodcastAudio } from '@/src/lib/db/user-podcast-audio';
import { logger } from '@/src/lib/logger';
import { getADSUrl, getLibraryItems } from '@/src/lib/ads/client';
import OpenAI from 'openai';
import { resolveLLMOptions, getOpenAICompatibleClient } from "@/src/lib/llm/client";
import { fetchFullText } from '@/src/lib/pipeline/fulltext';

export const dynamic = 'force-dynamic';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ResourcesAskRequest {
  question: string;
  libraryId?: string; // Deprecated: use libraryIds instead
  libraryIds?: string[]; // Array of research library IDs
  resourceLibraryIds?: string[]; // 'saved-items' | 'digest-items' | 'newsletter-library' | 'podcast-library'
  selectedBibcodes?: string[]; // Papers selected by user
  selectedItemIds?: string[]; // Items selected by user
  selectedNewsletterIds?: string[]; // Newsletters selected by user
  selectedPodcastIds?: string[]; // Podcasts selected by user
  limit?: number;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  conversationHistory?: ConversationMessage[]; // For follow-up questions
  papersContext?: string; // Pre-computed papers context from initial query (for follow-ups)
  itemsContext?: string; // Pre-computed items context from initial query (for follow-ups)
}

interface ResourcesAskResponse {
  answer: string;
  sourcesUsed: number;
  papersUsed?: number;
  itemsUsed?: number;
  newslettersUsed?: number;
  podcastsUsed?: number;
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

    const body = (await request.json()) as ResourcesAskRequest;
    const {
      question,
      limit = 20,
      libraryId, // Deprecated, kept for backward compatibility
      libraryIds,
      resourceLibraryIds,
      selectedBibcodes,
      selectedItemIds,
      selectedNewsletterIds,
      selectedPodcastIds,
      openaiApiKey: bodyOpenaiApiKey,
      openaiBaseUrl: bodyOpenaiBaseUrl,
      conversationHistory,
      papersContext,
      itemsContext
    } = body;

    if (!question || question.trim().length === 0) {
      return NextResponse.json(
        { error: 'Question is required' },
        { status: 400 }
      );
    }

    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const sessionUser = session?.user
      ? {
          email: session.user.email ?? undefined,
          emailVerified: (session.user as { emailVerified?: boolean }).emailVerified ?? undefined,
        }
      : undefined;

    const llmOptions = resolveLLMOptions(
      { openaiApiKey: bodyOpenaiApiKey, openaiBaseUrl: bodyOpenaiBaseUrl },
      undefined,
      sessionUser,
    );
    const llmClient = getOpenAICompatibleClient(llmOptions);
    if (!llmClient) {
      return NextResponse.json(
        {
          error:
            'LLM is required. Provide openaiApiKey (and optionally openaiBaseUrl) in the request body, or sign in with a verified Sourcegraph.com account.',
        },
        { status: 400 }
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
    let newsletterContextString: string = '';
    let podcastContextString: string = '';

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
          // Handle 'bookmarked' library specially - uses is_favorite flag, not junction table
          if (libId === 'bookmarked') {
            const favoritePapers = await getFavoritePapers(userId, limit);
            logger.info('Fetched bookmarked papers', { count: favoritePapers.length, userId });
            allPapers.push(...favoritePapers);
            continue;
          }

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
            const savedItems = await getSavedItems(limit, undefined, userId);
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
            const digestItems = await getDigestItems(limit, undefined, userId);
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

    // Fetch newsletters (selected ids or full newsletter library)
    const newsletterIdsToLoad: string[] =
      Array.isArray(selectedNewsletterIds) && selectedNewsletterIds.length > 0
        ? selectedNewsletterIds
        : resourceLibraryIds?.includes('newsletter-library')
          ? (await listGeneratedNewsletters(userId, limit)).map((n) => n.id)
          : [];
    const newsletters: Array<{ id: string; title: string; markdown: string | null }> = [];
    for (const id of newsletterIdsToLoad.slice(0, 10)) {
      const n = await getGeneratedNewsletter(id, userId);
      if (n) newsletters.push({ id: n.id, title: n.title, markdown: n.markdown });
    }

    // Fetch podcasts (selected ids or full podcast library)
    const podcastIdsToLoad: string[] =
      Array.isArray(selectedPodcastIds) && selectedPodcastIds.length > 0
        ? selectedPodcastIds
        : resourceLibraryIds?.includes('podcast-library')
          ? (await listUserPodcastAudio(userId, limit)).map((p) => p.id)
          : [];
    const podcasts: Array<{ id: string; title?: string; duration?: string }> = [];
    if (podcastIdsToLoad.length > 0) {
      const allPodcasts = await listUserPodcastAudio(userId, 50);
      const byId = new Map(allPodcasts.map((p) => [p.id, p]));
      for (const id of podcastIdsToLoad.slice(0, 10)) {
        const p = byId.get(id);
        if (p) podcasts.push({ id: p.id, title: p.title, duration: p.duration });
      }
    }

    // Populate full text for items that only have summary (so answers use article content, not RSS snippet)
    const MIN_FULLTEXT_LENGTH = 200;
    const MAX_ON_DEMAND_FETCH = 3;
    if (items.length > 0 && !itemsContextString) {
      const needFullText = items.filter(
        (item) => !item.fullText || item.fullText.length < MIN_FULLTEXT_LENGTH
      );
      const toFetch = needFullText.slice(0, MAX_ON_DEMAND_FETCH);
      if (toFetch.length > 0) {
        const results = await Promise.allSettled(
          toFetch.map((item) =>
            fetchFullText({
              id: item.id,
              streamId: '',
              title: item.title,
              url: item.url,
              sourceTitle: item.sourceTitle,
              summary: item.summary,
              contentSnippet: item.contentSnippet,
              category: (item.category || 'tech_articles') as import('@/src/lib/model').Category,
              categories: [],
              raw: {},
              publishedAt: item.publishedAt,
            })
          )
        );
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const item = toFetch[i];
          if (r.status === 'fulfilled' && r.value?.text && r.value.source !== 'error' && r.value.text.length >= MIN_FULLTEXT_LENGTH) {
            try {
              await saveFullText(item.id, r.value.text, r.value.source);
              item.fullText = r.value.text;
              logger.info('Fetched and saved full text for ask context', { itemId: item.id, title: item.title?.slice(0, 50), length: r.value.text.length });
            } catch (err) {
              logger.warn('Failed to save full text for item', { itemId: item.id, error: err });
            }
          }
        }
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

    // Build context from newsletters
    if (newsletters.length > 0) {
      const parts = newsletters.map((n, idx) => {
        const content = (n.markdown || '').slice(0, 8000);
        return `[Newsletter ${idx + 1}] Title: ${n.title}\n\n${content}${content.length >= 8000 ? '\n[... truncated ...]' : ''}`;
      });
      newsletterContextString = parts.join('\n\n---\n\n');
    }

    // Build context from podcasts (title/duration only; no transcript stored)
    if (podcasts.length > 0) {
      const parts = podcasts.map(
        (p, idx) =>
          `[Podcast ${idx + 1}] Title: ${p.title?.trim() || 'Untitled'}\nDuration: ${p.duration || 'N/A'}\n(Content is audio; use title and duration for reference.)`
      );
      podcastContextString = parts.join('\n\n---\n\n');
    }

    // Combine contexts
    const combinedContext = [
      papersContextString ? `RESEARCH PAPERS:\n${papersContextString}` : '',
      itemsContextString ? `RESOURCES:\n${itemsContextString}` : '',
      newsletterContextString ? `NEWSLETTERS:\n${newsletterContextString}` : '',
      podcastContextString ? `PODCASTS (metadata):\n${podcastContextString}` : '',
    ]
      .filter(Boolean)
      .join('\n\n==========\n\n');

    if (!combinedContext) {
      return NextResponse.json(
        { error: 'No papers, items, newsletters, or podcasts available to answer the question' },
        { status: 400 }
      );
    }

    logger.info('Generating answer from resources', {
      papersCount: papers.length,
      itemsCount: items.length,
      newslettersCount: newsletters.length,
      podcastsCount: podcasts.length,
      contextLength: combinedContext.length,
      isFollowUp,
    });

    // Build messages array
    const systemPrompt = `You are an expert research analyst specializing in synthesizing information from academic papers, newsletters, podcasts, and resources. When answering questions:
1. Provide concise, evidence-based answers (2-4 paragraphs for initial questions, shorter for follow-ups)
2. Quote specific relevant excerpts from the sources
3. For each quote or key finding, cite the source using [Paper N], [Item N], [Newsletter N], or [Podcast N] format where N is the source index
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
      : `Based on the following research papers, resources, newsletters, and podcasts, answer this question: "${question}"\n\nProvide an evidence-based answer with specific citations [Paper N], [Item N], [Newsletter N], or [Podcast N] for each key claim. Include direct quotes where relevant to support your synthesis.`;

    messages.push({ role: 'user', content: userContent });

    // Generate answer using GPT-4o-mini (client from BYOK or server env)
    const message = await llmClient.chat.completions.create({
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

    const newslettersCount = newsletters.length;
    const podcastsCount = podcasts.length;
    const totalSources = papers.length + items.length + newslettersCount + podcastsCount;

    return NextResponse.json({
      answer,
      sourcesUsed: totalSources,
      papersUsed: papers.length,
      itemsUsed: items.length,
      newslettersUsed: newslettersCount,
      podcastsUsed: podcastsCount,
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
