# Newsletter Export API Reference

## Endpoints

### 1. Generate Newsletter
**POST** `/api/newsletter/generate`

Generates a curated newsletter from selected categories.

**Request:**
```json
{
  "categories": ["tech_articles", "ai_news", "research"],
  "period": "week",
  "limit": 15,
  "prompt": "Focus on code search and semantic understanding"
}
```

**Response:**
```json
{
  "id": "nl-xxx-xxx",
  "title": "Code Intelligence Digest – Week of Dec 21, 2024",
  "generatedAt": "2024-12-21T10:00:00Z",
  "categories": ["tech_articles", "ai_news", "research"],
  "period": "week",
  "itemsRetrieved": 150,
  "itemsIncluded": 12,
  "summary": "Executive overview of the resources...",
  "markdown": "# Code Intelligence Digest\n...",
  "html": "<article>...</article>",
  "themes": ["code-search", "agents", "context-management"],
  "generationMetadata": {
    "promptUsed": "Focus on code search...",
    "modelUsed": "gpt-4o-mini",
    "tokensUsed": 3000,
    "duration": "5.2s",
    "promptProfile": null,
    "rerankApplied": false
  }
}
```

---

### 2. Download as Text/Markdown
**POST** `/api/newsletter/download`

Download newsletter as plain text or markdown file.

**Request:**
```json
{
  "html": "<article>...</article>",
  "markdown": "# Newsletter\n...",
  "title": "Code Intelligence Digest",
  "format": "txt"
}
```

**Parameters:**
- `html` (required): Newsletter HTML content
- `markdown` (required): Newsletter markdown content
- `title` (optional): Filename prefix
- `format` (required): `"txt"` or `"md"`

**Response:**
- **Status 200**: File data with `Content-Disposition: attachment`
- **Content-Type**: 
  - `text/plain; charset=utf-8` for `.txt`
  - `text/markdown; charset=utf-8` for `.md`

**Example Client Code:**
```typescript
const handleDownload = async (format: "txt" | "md") => {
  const response = await fetch("/api/newsletter/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html: newsletter.html,
      markdown: newsletter.markdown,
      title: newsletter.title,
      format: format
    })
  });
  
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `newsletter.${format}`;
  a.click();
  URL.revokeObjectURL(url);
};
```

---

### 3. Export as PDF
**POST** `/api/newsletter/pdf`

Export newsletter as print-ready HTML for PDF conversion.

**Request:**
```json
{
  "html": "<article>...</article>",
  "title": "Code Intelligence Digest",
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "generatedAt": "2024-12-21T10:00:00Z"
}
```

**Parameters:**
- `html` (required): Newsletter HTML content
- `title` (required): Newsletter title
- `categories` (required): Array of category strings
- `period` (required): `"week"` or `"month"`
- `generatedAt` (required): ISO 8601 timestamp

**Response:**
- **Status 200**: Self-contained HTML with embedded CSS
- **Content-Type**: `text/html; charset=utf-8`
- **Content-Disposition**: `inline; filename="newsletter.html"`

**Features:**
- ✅ Styled header with metadata
- ✅ Light theme (white background, readable fonts)
- ✅ All links are clickable in PDF
- ✅ Print-optimized (@media print rules)
- ✅ No external dependencies (fully self-contained)

**Example Client Code:**
```typescript
const handleExportPDF = async () => {
  const response = await fetch("/api/newsletter/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      html: newsletter.html,
      title: newsletter.title,
      categories: newsletter.categories,
      period: newsletter.period,
      generatedAt: newsletter.generatedAt
    })
  });
  
  const html = await response.text();
  
  // Open in new window for user to print
  const printWindow = window.open("", "", "width=900,height=800");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    
    // Wait for content to load before prompting print
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
};
```

**Printing to PDF:**
1. Call endpoint to get styled HTML
2. Opens in new browser window
3. User presses Ctrl+P / Cmd+P
4. Selects "Save as PDF" option
5. PDF includes all links, formatting, and metadata header

---

## Complete Example: Newsletter Viewer with Export

```typescript
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Newsletter {
  id: string;
  title: string;
  html: string;
  markdown: string;
  categories: string[];
  period: "week" | "month";
  generatedAt: string;
}

export function NewsletterViewer({ newsletter }: { newsletter: Newsletter }) {
  const [isExporting, setIsExporting] = useState(false);

  const downloadFile = async (format: "txt" | "md") => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/newsletter/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: newsletter.html,
          markdown: newsletter.markdown,
          title: newsletter.title,
          format: format
        })
      });

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${newsletter.title.replace(/\s+/g, "-")}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  const exportPDF = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/newsletter/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: newsletter.html,
          title: newsletter.title,
          categories: newsletter.categories,
          period: newsletter.period,
          generatedAt: newsletter.generatedAt
        })
      });

      const html = await response.text();
      const printWindow = window.open("", "", "width=900,height=800");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.print();
        }, 500);
      }
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <Button
          onClick={() => downloadFile("txt")}
          disabled={isExporting}
          variant="outline"
        >
          📄 Download Text
        </Button>
        <Button
          onClick={() => downloadFile("md")}
          disabled={isExporting}
          variant="outline"
        >
          📋 Download Markdown
        </Button>
        <Button
          onClick={exportPDF}
          disabled={isExporting}
          variant="default"
        >
          📑 Export PDF
        </Button>
      </div>

      {/* Newsletter content */}
      <div
        className="prose prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: newsletter.html }}
      />
    </div>
  );
}
```

---

## Error Handling

All endpoints return standard error responses:

**400 Bad Request:**
```json
{
  "error": "categories must be non-empty array"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Newsletter generation failed"
}
```

---

## Best Practices

1. **PDF Export Flow:**
   - Use `window.print()` in the new window
   - Let browser's print dialog handle PDF conversion
   - No server-side PDF generation needed
   - User has full control over settings

2. **File Downloads:**
   - Use `Content-Disposition: attachment` header
   - Browser automatically triggers download
   - Proper MIME types for file detection

3. **Error Handling:**
   - Always check response status
   - Display user-friendly error messages
   - Log detailed errors for debugging

4. **Performance:**
   - All endpoints are fast (no heavy processing)
   - HTML generation is < 1 second
   - Download triggers immediately on client
