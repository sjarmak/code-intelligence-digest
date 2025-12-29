import { NextRequest, NextResponse } from 'next/server';
import { getPaper, storePaper } from '@/src/lib/db/ads-papers';
import { getBibcodeMetadata, getADSUrl, getArxivUrl } from '@/src/lib/ads/client';
import { logger } from '@/src/lib/logger';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in summarize POST', { encodedBibcode });
    }
    const adsToken = process.env.ADS_API_TOKEN;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!adsToken) {
      return NextResponse.json(
        { error: 'ADS_API_TOKEN not configured in .env.local' },
        { status: 500 }
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

    logger.info('Generating paper summary', { bibcode });

    // Try to get from cache first
    let paper = await getPaper(bibcode);

    // If not in cache, fetch from ADS
    if (!paper) {
      const metadata = await getBibcodeMetadata([bibcode], adsToken);
      const paperData = metadata[bibcode];

      if (!paperData) {
        return NextResponse.json(
          { error: `Paper ${bibcode} not found` },
          { status: 404 }
        );
      }

      // Store it
      paper = {
        bibcode,
        title: paperData.title,
        authors: paperData.authors ? JSON.stringify(paperData.authors) : undefined,
        pubdate: paperData.pubdate,
        abstract: paperData.abstract,
        body: paperData.body,
        adsUrl: getADSUrl(bibcode),
        arxivUrl: getArxivUrl(bibcode),
        fulltextSource: paperData.body ? 'ads_api' : undefined,
      };

      await storePaper(paper);
    }

    // Generate summary using GPT-4o
    const textToSummarize = paper.body || paper.abstract || paper.title || bibcode;

    if (!textToSummarize) {
      return NextResponse.json(
        { error: 'No content available to summarize' },
        { status: 400 }
      );
    }

    const message = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Please provide a concise 2-3 sentence summary of this academic paper:\n\nTitle: ${paper.title || 'Unknown'}\n\nContent:\n${textToSummarize.substring(0, 8000)}`,
        },
      ],
    });

    const summary = message.choices[0]?.message?.content || 'Failed to generate summary';

    logger.info('Paper summary generated', { bibcode, summaryLength: summary.length });

    return NextResponse.json({ summary });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate paper summary', { error: errorMsg });

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
      { error: 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
