/**
 * POST /api/newsletter/download
 * Download newsletter as plain text file
 */

import { NextRequest, NextResponse } from "next/server";
import { htmlToPlainText } from "@/src/lib/pipeline/pdf";
import { logger } from "@/src/lib/logger";

interface DownloadRequest {
  html: string;
  markdown: string;
  title: string;
  format: "txt" | "md";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as DownloadRequest;

    if (!body.html && !body.markdown) {
      return NextResponse.json(
        { error: "Either html or markdown content is required" },
        { status: 400 }
      );
    }

    const format = body.format || "txt";
    const title = body.title || "Code-Intelligence-Digest";
    const filename = `${title.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.${format}`;

    let content: string;
    if (format === "md") {
      content = body.markdown || htmlToPlainText(body.html);
    } else {
      content = body.markdown ? htmlToPlainText(`<pre>${body.markdown}</pre>`) : htmlToPlainText(body.html);
    }

    logger.info(`Newsletter download: format=${format}, size=${content.length}b`);

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": Buffer.byteLength(content).toString(),
      },
    });
  } catch (error) {
    logger.error("Newsletter download failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
