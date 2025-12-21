/**
 * POST /api/newsletter/pdf
 * Export newsletter as PDF (returns HTML optimized for print-to-PDF)
 * 
 * Client should:
 * 1. Render in browser
 * 2. Use window.print() or Ctrl+P
 * 3. Save as PDF
 * 
 * OR use a headless browser library for automatic generation (see alternative below)
 */

import { NextRequest, NextResponse } from "next/server";
import { generatePDFHTML } from "@/src/lib/pipeline/pdf";
import { logger } from "@/src/lib/logger";

interface PDFRequest {
  html: string;
  title: string;
  categories: string[];
  period: "week" | "month";
  generatedAt: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as PDFRequest;

    if (!body.html) {
      return NextResponse.json(
        { error: "html content is required" },
        { status: 400 }
      );
    }

    if (!body.categories || !Array.isArray(body.categories)) {
      return NextResponse.json(
        { error: "categories array is required" },
        { status: 400 }
      );
    }

    if (!body.period || !["week", "month"].includes(body.period)) {
      return NextResponse.json(
        { error: 'period must be "week" or "month"' },
        { status: 400 }
      );
    }

    if (!body.generatedAt) {
      return NextResponse.json(
        { error: "generatedAt is required" },
        { status: 400 }
      );
    }

    const pdfHTML = generatePDFHTML(body.html, {
      title: body.title || "Code Intelligence Digest",
      categories: body.categories,
      period: body.period,
      generatedAt: body.generatedAt,
    });

    logger.info(`PDF generation: title=${body.title}, size=${pdfHTML.length}b`);

    // Return as HTML that client can print-to-PDF
    return new NextResponse(pdfHTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="newsletter.html"`,
      },
    });
  } catch (error) {
    logger.error("Newsletter PDF generation failed", { error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
