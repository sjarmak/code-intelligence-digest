import { NextRequest, NextResponse } from 'next/server';
import {
  createAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
  initializeAnnotationTables,
  getPaperNotes,
  updatePaperNotes,
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
 * GET /api/papers/[bibcode]/annotations
 * Get all annotations for a paper, including paper-level notes
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    const bibcode = decodeURIComponent(encodedBibcode);

    logger.info('Fetching annotations', { bibcode });

    const annotations = getAnnotations(bibcode);
    const paperNotes = getPaperNotes(bibcode);

    return NextResponse.json({
      bibcode,
      annotations,
      paperNotes,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch annotations', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch annotations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/papers/[bibcode]/annotations
 * Create a new annotation or update paper notes
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    const bibcode = decodeURIComponent(encodedBibcode);
    const body = await request.json();

    // Handle paper-level notes update
    if (body.action === 'updatePaperNotes') {
      const { notes } = body;
      const success = updatePaperNotes(bibcode, notes);

      if (!success) {
        return NextResponse.json(
          { error: 'Failed to update paper notes' },
          { status: 500 }
        );
      }

      logger.info('Paper notes updated', { bibcode });
      return NextResponse.json({ success: true, paperNotes: notes });
    }

    // Handle annotation creation
    const { type, content, note, startOffset, endOffset, sectionId } = body;

    if (!type || !content) {
      return NextResponse.json(
        { error: 'type and content are required' },
        { status: 400 }
      );
    }

    if (type !== 'note' && type !== 'highlight') {
      return NextResponse.json(
        { error: 'type must be "note" or "highlight"' },
        { status: 400 }
      );
    }

    const annotation = createAnnotation({
      bibcode,
      type,
      content,
      note,
      startOffset,
      endOffset,
      sectionId,
    });

    logger.info('Annotation created', { bibcode, annotationId: annotation.id, type });

    return NextResponse.json(annotation, { status: 201 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to create annotation', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to create annotation' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/papers/[bibcode]/annotations
 * Update an existing annotation
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    const bibcode = decodeURIComponent(encodedBibcode);
    const body = await request.json();

    const { id, content, note } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    const updated = updateAnnotation(id, { content, note });

    if (!updated) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    logger.info('Annotation updated', { bibcode, annotationId: id });

    return NextResponse.json(updated);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update annotation', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to update annotation' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/papers/[bibcode]/annotations
 * Delete an annotation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ bibcode: string }> }
) {
  try {
    ensureTablesInitialized();

    const { bibcode: encodedBibcode } = await params;
    const bibcode = decodeURIComponent(encodedBibcode);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const deleted = deleteAnnotation(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }

    logger.info('Annotation deleted', { bibcode, annotationId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to delete annotation', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to delete annotation' },
      { status: 500 }
    );
  }
}
