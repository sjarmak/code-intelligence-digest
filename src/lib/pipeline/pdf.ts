/**
 * Newsletter PDF generation
 * Converts HTML newsletter to PDF-ready HTML with embedded styles
 */

export interface PDFOptions {
  title: string;
  categories: string[];
  period: "week" | "month";
  generatedAt: string;
}

/**
 * Convert newsletter HTML to PDF-ready HTML with embedded styles and header
 */
export function generatePDFHTML(
  newsletterHTML: string,
  options: PDFOptions
): string {
  const categoryLabel = options.categories.join(", ");
  const periodLabel = options.period === "week" ? "Weekly" : "Monthly";
  const dateStr = new Date(options.generatedAt).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${options.title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      background: #ffffff;
    }
    
    .pdf-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px 30px;
      margin-bottom: 30px;
      border-radius: 4px;
    }
    
    .pdf-header h1 {
      font-size: 28px;
      margin-bottom: 8px;
      font-weight: 700;
    }
    
    .pdf-header .meta {
      font-size: 13px;
      opacity: 0.95;
      display: flex;
      gap: 16px;
      margin-top: 12px;
    }
    
    .pdf-header .meta-item {
      display: flex;
      gap: 4px;
    }
    
    .pdf-header .meta-label {
      font-weight: 600;
    }
    
    article {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 30px 30px;
    }
    
    h1 {
      font-size: 24px;
      margin: 24px 0 16px;
      color: #1a1a1a;
      font-weight: 700;
    }
    
    h2 {
      font-size: 18px;
      margin: 20px 0 12px;
      color: #2d3748;
      font-weight: 600;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }
    
    p {
      margin: 12px 0;
      color: #4a5568;
      font-size: 14px;
    }
    
    section {
      margin: 24px 0;
    }
    
    ul, ol {
      margin: 12px 0 12px 24px;
      color: #4a5568;
      font-size: 14px;
    }
    
    li {
      margin: 8px 0;
      line-height: 1.6;
    }
    
    a {
      color: #667eea;
      text-decoration: none;
      word-break: break-word;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    blockquote {
      border-left: 4px solid #667eea;
      padding: 12px 16px;
      margin: 16px 0;
      background: #f7fafc;
      font-style: italic;
      color: #2d3748;
      font-size: 14px;
    }
    
    .summary {
      background: #f0f4ff;
      border-left: 4px solid #667eea;
      padding: 16px;
      margin: 16px 0;
      border-radius: 4px;
      font-size: 14px;
      color: #2d3748;
      line-height: 1.7;
    }
    
    .themes {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 16px 0;
    }
    
    .theme-tag {
      display: inline-block;
      background: #edf2f7;
      color: #2d3748;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
    }
    
    .pdf-footer {
      text-align: center;
      color: #718096;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
    }
    
    @media print {
      body {
        background: white;
      }
      
      .pdf-header {
        page-break-after: avoid;
      }
      
      h2 {
        page-break-after: avoid;
      }
      
      li {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="pdf-header">
    <h1>Code Intelligence Digest</h1>
    <div class="meta">
      <div class="meta-item">
        <span class="meta-label">Period:</span>
        <span>${periodLabel}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Categories:</span>
        <span>${categoryLabel}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Generated:</span>
        <span>${dateStr}</span>
      </div>
    </div>
  </div>
  
  ${newsletterHTML}
  
  <div class="pdf-footer">
    <p>Code Intelligence Digest • Powered by AI-driven curation</p>
  </div>
</body>
</html>`;
}

/**
 * Convert HTML to plain text (for email/sharing)
 * Simple HTML to text conversion
 */
export function htmlToPlainText(html: string): string {
  return html
    // Remove script and style elements
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<style[^>]*>.*?<\/style>/gi, "")
    // Replace line breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/g, "\n")
    .replace(/<\/li>/g, "\n")
    .replace(/<\/div>/g, "\n")
    // Replace headings with emphasis
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n$1\n")
    // Extract links as [text](url)
    .replace(/<a[^>]*href=["']([^"']*?)["'][^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    // Remove other HTML tags
    .replace(/<[^>]+>/g, "")
    // Decode HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up multiple newlines
    .replace(/\n\n\n+/g, "\n\n")
    .trim();
}
