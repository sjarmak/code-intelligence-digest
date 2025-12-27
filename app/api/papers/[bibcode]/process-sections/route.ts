/**
 * API endpoint to process sections for a specific paper
 * POST /api/papers/[bibcode]/process-sections
 */

import { NextRequest, NextResponse } from 'next/server';
import { processPaperSections } from '@/src/lib/pipeline/section-summarization';
import { initializePaperSectionsTable } from '@/src/lib/db/paper-sections';
import { getPaper } from '@/src/lib/db/ads-papers';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    const { bibcode: encodedBibcode } = await params;

    // Decode bibcode
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch {
      bibcode = encodedBibcode;
    }

    // Check if paper exists
    const paper = getPaper(bibcode);
    if (!paper) {
      return NextResponse.json(
        { error: `Paper ${bibcode} not found` },
        { status: 404 }
      );
    }

    if (!paper.body || paper.body.length < 100) {
      return NextResponse.json(
        { error: `Paper ${bibcode} has no body text to process` },
        { status: 400 }
      );
    }

    // Initialize tables
    initializePaperSectionsTable();

    // Process sections
    logger.info('Processing paper sections', { bibcode });
    await processPaperSections(bibcode);

    // Get section count
    const { getSectionSummaries } = await import('@/src/lib/db/paper-sections');
    const sections = getSectionSummaries(bibcode);

    return NextResponse.json({
      success: true,
      bibcode,
      sectionCount: sections.length,
      message: `Processed ${sections.length} sections for paper ${bibcode}`,
    });
  } catch (error) {
    logger.error('Failed to process paper sections', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to process paper sections',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

