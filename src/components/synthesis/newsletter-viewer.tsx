/**
 * Newsletter viewer component - display generated newsletter
 */

"use client";

import React, { useState } from "react";

/**
 * Parse markdown formatting in summary text
 */
function parseMarkdownText(text: string): React.ReactNode {
  if (!text) return null;
  
  // Split by ** to handle bold sections
  // Match ** followed by anything (non-greedy) followed by **
  const parts = text.split(/(\*\*.*?\*\*)/g);
  
  return (
    <>
      {parts.map((part, idx) => {
        // Check if this part is bold markdown
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          const boldText = part.slice(2, -2);
          return (
            <strong key={idx} style={{ fontWeight: 600, color: "inherit" }}>
              {boldText}
            </strong>
          );
        }
        // Return regular text (including empty strings)
        return part ? <span key={idx}>{part}</span> : null;
      })}
    </>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  newsletters: "Newsletters",
  podcasts: "Podcasts",
  tech_articles: "Tech Articles",
  ai_news: "AI News",
  product_news: "Product News",
  community: "Community",
  research: "Research",
};

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
  const [generatedDate, setGeneratedDate] = useState("");

  React.useEffect(() => {
    setGeneratedDate(new Date(generatedAt).toLocaleString());
  }, [generatedAt]);

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

  return (
    <div className="space-y-4">
      {/* Header Card - Light, Simple */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-500 mt-1">{generatedDate}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-gray-900">{itemsIncluded}</p>
            <p className="text-xs text-gray-500">items included</p>
          </div>
        </div>

        {/* Categories Pills */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span key={cat} className="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full border border-gray-200">
              {CATEGORY_LABELS[cat] || cat}
            </span>
          ))}
        </div>

        {/* Summary */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-sm leading-relaxed text-gray-700">{parseMarkdownText(summary)}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCopyMarkdown}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Copy Markdown
          </button>
          <button
            onClick={handleDownloadMarkdown}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Download MD
          </button>
          <button
            onClick={handleDownloadHTML}
            className="px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Download HTML
          </button>
          <button
            onClick={handleDownloadPDF}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded-md text-white font-medium transition-colors"
          >
            📄 Download PDF
          </button>
        </div>
      </div>

      {/* Content Card with Tabs */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="border-b border-gray-200 flex">
          {(["rendered", "markdown"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab === "rendered" && "Newsletter"}
              {tab === "markdown" && "Markdown"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === "rendered" && (
            <div
              className="prose prose-sm max-w-none prose-a:text-blue-600 prose-a:hover:text-blue-700 prose-a:underline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {activeTab === "markdown" && (
            <pre className="bg-gray-50 p-4 rounded border border-gray-200 overflow-x-auto text-sm text-gray-700">
              {markdown}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
