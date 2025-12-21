/**
 * Newsletter viewer component - display generated newsletter
 */

"use client";

import React, { useState } from "react";

interface NewsletterViewerProps {
  id: string;
  title: string;
  generatedAt: string;
  categories: string[];
  period: string;
  itemsRetrieved: number;
  itemsIncluded: number;
  summary: string;
  markdown: string;
  html: string;
  themes: string[];
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    duration: string;
    promptProfile?: Record<string, unknown>;
    rerankApplied: boolean;
  };
}

export function NewsletterViewer({
  id,
  title,
  generatedAt,
  categories,
  period,
  itemsRetrieved,
  itemsIncluded,
  summary,
  markdown,
  html,
  themes,
  generationMetadata,
}: NewsletterViewerProps) {
  const [activeTab, setActiveTab] = useState<"rendered" | "markdown" | "metadata">("rendered");

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdown);
    alert("Markdown copied to clipboard!");
  };

  const handleDownloadMarkdown = () => {
    const element = document.createElement("a");
    element.setAttribute("href", `data:text/plain;charset=utf-8,${encodeURIComponent(markdown)}`);
    element.setAttribute("download", `${id}-newsletter.md`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDownloadHTML = () => {
    const element = document.createElement("a");
    const htmlDoc = `<!DOCTYPE html>
  <html>
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { color: #1f2937; margin-bottom: 0.5rem; }
    h2 { color: #374151; margin-top: 1.5rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    blockquote { border-left: 4px solid #3b82f6; padding-left: 1rem; margin: 1rem 0; color: #4b5563; font-style: italic; }
    a { color: #3b82f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .metadata { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; margin: 1rem 0; font-size: 0.875rem; }
  </style>
  </head>
  <body>
  ${html}
  <hr style="margin-top: 2rem; border: none; border-top: 1px solid #e5e7eb;">
  <div class="metadata">
    <p><strong>Generated:</strong> ${new Date(generatedAt).toLocaleString()}</p>
    <p><strong>Categories:</strong> ${categories.join(", ")}</p>
    <p><strong>Items:</strong> ${itemsIncluded} selected from ${itemsRetrieved} retrieved</p>
    <p><strong>Model:</strong> ${generationMetadata.modelUsed} | <strong>Tokens:</strong> ${generationMetadata.tokensUsed}</p>
  </div>
  </body>
  </html>`;
    element.setAttribute("href", `data:text/html;charset=utf-8,${encodeURIComponent(htmlDoc)}`);
    element.setAttribute("download", `${id}-newsletter.html`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDownloadPDF = async () => {
    try {
      const response = await fetch("/api/newsletter/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html,
          title,
          categories,
          period,
          generatedAt,
        }),
      });

      if (!response.ok) {
        throw new Error(`PDF generation failed: ${response.statusText}`);
      }

      // Get HTML content and open in new tab for print-to-PDF
      const pdfHTML = await response.text();
      const blob = new Blob([pdfHTML], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const newWindow = window.open(url, "_blank");
      if (newWindow) {
        // Wait for page to load, then trigger print
        setTimeout(() => {
          newWindow.print();
        }, 500);
      }
    } catch (error) {
      alert(`Failed to generate PDF: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const generatedDate = new Date(generatedAt).toLocaleString();

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            <p className="text-sm text-muted mt-1">{generatedDate}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-400">{itemsIncluded}</p>
            <p className="text-xs text-muted">items included</p>
          </div>
        </div>

        {/* Categories and Stats */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-surface-border">
          <div>
            <p className="text-xs font-semibold text-muted uppercase">Categories</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {categories.map((cat) => (
                <span key={cat} className="inline-block px-2 py-1 bg-blue-900/30 text-blue-400 text-xs rounded border border-blue-700">
                  {cat}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted uppercase">Themes</p>
            <div className="flex flex-wrap gap-1 mt-2">
              {themes.slice(0, 3).map((theme) => (
                <span key={theme} className="inline-block px-2 py-1 bg-purple-900/30 text-purple-400 text-xs rounded border border-purple-700">
                  #{theme.replace(/_|-/g, "-")}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-blue-900/30 border border-blue-700 rounded p-3 mt-4">
          <p className="text-xs font-semibold text-blue-400 mb-2">Executive Summary</p>
          <p className="text-sm text-blue-300 leading-relaxed">{summary}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={handleCopyMarkdown}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-black text-foreground font-medium"
          >
            Copy Markdown
          </button>
          <button
            onClick={handleDownloadMarkdown}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-black text-foreground font-medium"
          >
            Download MD
          </button>
          <button
            onClick={handleDownloadHTML}
            className="px-3 py-2 text-sm border border-surface-border rounded hover:bg-black text-foreground font-medium"
          >
            Download HTML
          </button>
          <button
            onClick={handleDownloadPDF}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded text-white font-medium"
          >
            📄 Download PDF
          </button>
        </div>
      </div>

      {/* Content Card with Tabs */}
      <div className="bg-surface rounded-lg border border-surface-border shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-surface-border flex">
          {(["rendered", "markdown", "metadata"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-400 text-blue-400"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab === "rendered" && "Rendered"}
              {tab === "markdown" && "Markdown"}
              {tab === "metadata" && "Metadata"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "rendered" && (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {activeTab === "markdown" && (
            <pre className="bg-black p-4 rounded border border-surface-border overflow-x-auto text-sm text-foreground">
              {markdown}
            </pre>
          )}

          {activeTab === "metadata" && (
            <div className="space-y-2 text-sm">
              <p>
                <strong>ID:</strong> <code className="bg-black px-2 py-1 rounded text-xs text-foreground">{id}</code>
              </p>
              <p>
                <strong>Generated:</strong> {generatedDate}
              </p>
              <p>
                <strong>Period:</strong> {period}
              </p>
              <p>
                <strong>Model:</strong> {generationMetadata.modelUsed}
              </p>
              <p>
                <strong>Tokens:</strong> {generationMetadata.tokensUsed}
              </p>
              <p>
                <strong>Duration:</strong> {generationMetadata.duration}
              </p>
              <p>
                <strong>Re-rank Applied:</strong> {generationMetadata.rerankApplied ? "Yes" : "No"}
              </p>
              {generationMetadata.promptUsed && (
                <p>
                  <strong>Prompt:</strong>
                  <br />
                  <span className="text-muted italic">{generationMetadata.promptUsed}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
