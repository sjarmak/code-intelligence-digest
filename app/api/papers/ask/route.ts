import { NextRequest, NextResponse } from 'next/server';
import { searchPapers, getPaper, getLibraryPapers } from '@/src/lib/db/ads-papers';
import type { ADSPaperRecord } from '@/src/lib/db/ads-papers';
import { logger } from '@/src/lib/logger';
import { getADSUrl } from '@/src/lib/ads/client';
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
  libraryId?: string;
  selectedBibcodes?: string[]; // Papers selected by user
  limit?: number;
  conversationHistory?: ConversationMessage[]; // For follow-up questions
  papersContext?: string; // Pre-computed papers context from initial query (for follow-ups)
}

export async function POST(request: NextRequest) {
  try {
    const { 
      question, 
      limit = 20, 
      libraryId, 
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
    logger.info('Processing question', { 
      question, 
      hasSelectedPapers: !!selectedBibcodes?.length, 
      hasLibrary: !!libraryId,
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
        ? selectedBibcodes
            .map((bibcode: string) => getPaper(bibcode))
            .filter((p): p is ADSPaperRecord => p !== null)
        : [];
    } else {
      // Initial query: fetch papers
      if (selectedBibcodes && selectedBibcodes.length > 0) {
        // Use user-selected papers
        logger.info('Using selected papers', { count: selectedBibcodes.length });
        papers = selectedBibcodes
          .map((bibcode: string) => getPaper(bibcode))
          .filter((p): p is ADSPaperRecord => p !== null);
      } else if (libraryId) {
        // Use papers from selected library
        logger.info('Fetching papers from library', { libraryId, limit });
        papers = getLibraryPapers(libraryId, limit);
      } else {
        // Fall back to search all cached papers
        logger.info('Searching all papers', { question });
        papers = searchPapers(question, limit);
      }

      if (papers.length === 0) {
        return NextResponse.json(
          { answer: 'No papers found matching your query. Try a different search term.' },
          { status: 200 }
        );
      }

      // Prepare context from papers with bibcodes for citation
      context = papers
        .slice(0, 10) // Limit to top 10 papers to avoid token overflow
        .map((p, idx) => {
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
          return `[${idx + 1}] Bibcode: ${p.bibcode}\nTitle: ${p.title || p.bibcode}\nAuthors: ${authorStr}\nAbstract: ${p.abstract || 'N/A'}`;
        })
        .join('\n\n---\n\n');
    }

    logger.info('Generating answer from papers', {
      papersCount: papers.length,
      contextLength: context.length,
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
