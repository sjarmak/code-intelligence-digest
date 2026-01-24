import { NextRequest, NextResponse } from 'next/server';
import {
  getAllTags,
  createTag,
  updateTag,
  deleteTag,
  getTagByName,
  getPapersWithTag,
  initializeAnnotationTables,
} from '@/src/lib/db/paper-annotations';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Initialize tables on first import
let tablesInitialized = false;
async function ensureTablesInitialized() {
  if (!tablesInitialized) {
    try {
      await initializeAnnotationTables();
      tablesInitialized = true;
    } catch (error) {
      logger.warn('Tables may already exist', { error });
      tablesInitialized = true;
    }
  }
}

/**
 * GET /api/tags
 * Get all tags with optional paper counts
 */
export async function GET(request: NextRequest) {
  try {
      await ensureTablesInitialized();

    const { searchParams } = new URL(request.url);
    const includeCounts = searchParams.get('counts') === 'true';

    logger.info('Fetching all tags', { includeCounts });

    const tags = await getAllTags();

    if (includeCounts) {
      const tagsWithCounts = await Promise.all(tags.map(async (tag) => ({
        ...tag,
        paperCount: (await getPapersWithTag(tag.id)).length,
      })));
      return NextResponse.json({ tags: tagsWithCounts });
    }

    return NextResponse.json({ tags });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch tags', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to fetch tags' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tags
 * Create a new tag
 */
export async function POST(request: NextRequest) {
  try {
      await ensureTablesInitialized();

    const body = await request.json();
    const { name, color } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'name is required' },
        { status: 400 }
      );
    }

    // Check if tag already exists
    const existing = await getTagByName(name);
    if (existing) {
      return NextResponse.json(
        { error: 'Tag with this name already exists', tag: existing },
        { status: 409 }
      );
    }

    const tag = await createTag({ name, color });

    logger.info('Tag created', { tagId: tag.id, name });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to create tag', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to create tag' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tags
 * Update an existing tag
 */
export async function PATCH(request: NextRequest) {
  try {
      await ensureTablesInitialized();

    const body = await request.json();
    const { id, name, color } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    // If updating name, check for duplicates
    if (name) {
      const existing = await getTagByName(name);
      if (existing && existing.id !== id) {
        return NextResponse.json(
          { error: 'Tag with this name already exists' },
          { status: 409 }
        );
      }
    }

    const updated = await updateTag(id, { name, color });

    if (!updated) {
      return NextResponse.json(
        { error: 'Tag not found' },
        { status: 404 }
      );
    }

    logger.info('Tag updated', { tagId: id });

    return NextResponse.json(updated);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to update tag', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to update tag' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tags
 * Delete a tag
 */
export async function DELETE(request: NextRequest) {
  try {
      await ensureTablesInitialized();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      );
    }

    const deleted = await deleteTag(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Tag not found' },
        { status: 404 }
      );
    }

    logger.info('Tag deleted', { tagId: id });

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to delete tag', { error: errorMsg });

    return NextResponse.json(
      { error: 'Failed to delete tag' },
      { status: 500 }
    );
  }
}
