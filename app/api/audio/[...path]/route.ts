/**
 * GET /api/audio/[...path]
 * Serve audio files from .data/audio directory
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { logger } from "@/src/lib/logger";

const AUDIO_DIR = path.join(process.cwd(), ".data", "audio");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path: pathSegments } = await params;
  const filePath = path.join(AUDIO_DIR, ...pathSegments);

  // Security: ensure path doesn't escape audio directory
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(AUDIO_DIR)) {
    logger.warn("Audio path escape attempt", { path: pathSegments.join("/") });
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Check if file exists
  if (!fs.existsSync(normalizedPath)) {
    logger.warn("Audio file not found", { path: normalizedPath });
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();

    const contentType = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : "application/octet-stream";

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    logger.error("Failed to serve audio file", {
      path: normalizedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
