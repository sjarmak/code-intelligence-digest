import { NextRequest, NextResponse } from 'next/server';
import {
  getPaperTags,
  addTagToPaper,
  removeTagFromPaper,
  createTag,
  getTagByName,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize tables on first import
let tablesInitialized = false;
function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      initializeAnnotationTables();
      tablesInitialized = true;
    } catch (error) {
      logger.warn('Tables may already exist', { error });
      tablesInitialized = true;
    }
  }
}

/**
 * GET /api/papers/[bibcode]/tags
 * Get all tags for a paper
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in tags GET', { encodedBibcode });
    }

    logger.info('Fetching paper tags', { bibcode });

    const tags = getPaperTags(bibcode);

    return NextResponse.json({
      bibcode,
      tags,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch paper tags', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/papers/[bibcode]/tags
 * Add a tag to a paper (by tagId or create new by name)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in tags POST', { encodedBibcode });
    }
    const body = await request.json();

    const { tagId, name, color } = body;

    if (!tagId && !name) {
      return NextResponse.json(
        { error: 'Either tagId or name is required' },
        { status: 400 }
      );
    }

    let finalTagId = tagId;

    // If name is provided, find or create the tag
    if (name) {
      let tag = getTagByName(name);

      if (!tag) {
        tag = createTag({ name, color });
        logger.info('Created new tag', { tagId: tag.id, name });
      }

      finalTagId = tag.id;
    }

    const success = addTagToPaper(bibcode, finalTagId);

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to add tag to paper' },
        { status: 500 }
      );
    }

    // Return updated tags list
    const tags = getPaperTags(bibcode);

    logger.info('Tag added to paper', { bibcode, tagId: finalTagId });

    return NextResponse.json({
      success: true,
      tags,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to add tag to paper', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to add tag' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/papers/[bibcode]/tags
 * Remove a tag from a paper
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    let bibcode: string;
    try {
      bibcode = decodeURIComponent(encodedBibcode);
    } catch (error) {
      bibcode = encodedBibcode;
      logger.warn('Bibcode decoding failed in tags DELETE', { encodedBibcode });
    }

    const { searchParams } = new URL(request.url);
    const tagId = searchParams.get('tagId');

    if (!tagId) {
      return NextResponse.json(
        { error: 'tagId query parameter is required' },
        { status: 400 }
      );
    }

    const removed = removeTagFromPaper(bibcode, tagId);

    if (!removed) {
      return NextResponse.json(
        { error: 'Tag not found on paper' },
        { status: 404 }
      );
    }

    // Return updated tags list
    const tags = getPaperTags(bibcode);

    logger.info('Tag removed from paper', { bibcode, tagId });

    return NextResponse.json({
      success: true,
      tags,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to remove tag from paper', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to remove tag' },
      { status: 500 }
    );
  }
}
