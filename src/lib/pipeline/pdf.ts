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
      color: #2d3748;
      background: #ffffff;
    }
    
    .pdf-header {
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      color: white;
      padding: 50px 40px;
      margin-bottom: 40px;
      border-radius: 0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .pdf-header h1 {
      font-size: 32px;
      margin: 0 0 12px 0;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    
    .pdf-header .meta {
      font-size: 14px;
      opacity: 0.95;
      display: flex;
      gap: 24px;
      margin-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.2);
      padding-top: 12px;
    }
    
    .pdf-header .meta-item {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    
    .pdf-header .meta-label {
      font-weight: 700;
      opacity: 0.9;
    }
    
    article {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 30px 30px;
    }
    
    h1 {
      font-size: 28px;
      margin: 28px 0 16px;
      color: #1a202c;
      font-weight: 800;
    }
    
    h2 {
      font-size: 20px;
      margin: 24px 0 14px;
      color: #2563eb;
      font-weight: 700;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 8px;
    }
    
    p {
      margin: 14px 0;
      color: #2d3748;
      font-size: 15px;
      line-height: 1.7;
    }
    
    section {
      margin: 28px 0;
    }
    
    ul, ol {
      margin: 14px 0 14px 32px;
      color: #2d3748;
      font-size: 15px;
    }
    
    li {
      margin: 10px 0;
      line-height: 1.7;
    }
    
    a {
      color: #2563eb;
      text-decoration: underline;
      word-break: break-word;
    }
    
    a:hover {
      color: #1e40af;
    }
    
    blockquote {
      border-left: 4px solid #2563eb;
      padding: 14px 18px;
      margin: 18px 0;
      background: #f0f9ff;
      font-style: italic;
      color: #1e40af;
      font-size: 14px;
      line-height: 1.7;
    }
    
    .summary {
      background: #f0f9ff;
      border-left: 4px solid #2563eb;
      padding: 18px;
      margin: 18px 0;
      border-radius: 4px;
      font-size: 15px;
      color: #1e3a8a;
      line-height: 1.8;
    }
    
    .themes {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 18px 0;
    }
    
    .theme-tag {
      display: inline-block;
      background: #dbeafe;
      color: #1e40af;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    
    .pdf-footer {
      text-align: center;
      color: #64748b;
      font-size: 12px;
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #cbd5e1;
    }
    
    /* Prevent url() from printing */
    a {
      text-decoration: none;
    }
    
    a::after {
      content: none !important;
    }
    
    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      
      body {
        background: white;
        margin: 0;
        padding: 0;
      }
      
      @page {
        margin: 0.5in;
        size: letter;
      }
      
      /* Disable browser default headers/footers */
      @page {
        @top-left {
          content: none !important;
        }
        @top-center {
          content: none !important;
        }
        @top-right {
          content: none !important;
        }
        @bottom-left {
          content: none !important;
        }
        @bottom-center {
          content: none !important;
        }
        @bottom-right {
          content: none !important;
        }
      }
      
      .pdf-header {
        page-break-after: avoid;
        margin-top: 0;
        padding-top: 0;
      }
      
      h2 {
        page-break-after: avoid;
      }
      
      li {
        page-break-inside: avoid;
      }
      
      article {
        max-width: 100%;
        margin: 0;
        padding: 0;
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
   
   <script>
     // Auto-trigger print dialog with proper settings
     window.addEventListener('load', function() {
       // Delay slightly to let page render first
       setTimeout(function() {
         // For Chrome/Edge: settings are passed via window.print()
         // Note: Users may need to manually disable "Headers and footers" in print dialog
         console.log('PDF is ready. To print:');
         console.log('1. Click the Print button (or Cmd+P / Ctrl+P)');
         console.log('2. In Print Settings, disable "Headers and footers"');
         console.log('3. Set margins to "Minimal" or "0.5 inches"');
         console.log('4. Click Print or Save as PDF');
       }, 500);
     });
   </script>
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
