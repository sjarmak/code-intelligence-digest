# Synthesis UI Guide

Quick guide to accessing and using the newsletter and podcast generation UI.

---

## Quick Start

### 1. Navigate to Synthesis Hub

**From the main page** (`http://localhost:3000`):
- Click the **✨ Synthesis** button in the top navigation

Or directly visit:
- **Synthesis Hub**: `http://localhost:3000/synthesis`
- **Podcast Generator**: `http://localhost:3000/synthesis/podcast`
- **Newsletter Generator**: `http://localhost:3000/synthesis/newsletter`

---

## Podcast Generation UI

### Location
`http://localhost:3000/synthesis/podcast`

### Features

**Form (Left Column):**
- ✅ Multi-select content categories (newsletters, podcasts, tech_articles, ai_news, product_news, community, research)
- ✅ Period selector (week or month)
- ✅ Item limit (1-50)
- ✅ Voice style selector (conversational, technical, executive)
- ✅ Optional guidance prompt
- ✅ Generate button with loading state

**Results (Right Column):**

When generation completes, displays:

1. **Header Card**
   - Episode title
   - Generation timestamp
   - Duration estimate
   - Stats: Period, Items included, Voice style
   - Categories badges
   - Action buttons:
     - 📋 Copy Transcript
     - ⬇️ Download TXT
     - 📝 Show Notes (download MD)

2. **Tabbed Content**
   - **Segments Tab**: Interactive segment cards with:
     - Segment title & timings
     - Key points / highlights
     - Referenced items with direct links
   - **Transcript Tab**: Full episode transcript (plain text)
   - **Show Notes Tab**: Markdown-formatted show notes
   - **Metadata Tab**: Generation details (model, tokens, duration)

### Example Workflow

1. **Select categories**: Check "AI News", "Product News"
2. **Choose period**: Select "week"
3. **Set voice**: Choose "technical"
4. **Add prompt** (optional): "Focus on code agents and semantic search"
5. **Click**: "🎙️ Generate Podcast"
6. **Wait**: 2-5 seconds for generation
7. **View results**: Transcript appears in right panel
8. **Download**: Use action buttons to export

---

## Newsletter Generation UI

### Location
`http://localhost:3000/synthesis/newsletter`

### Features (Similar to Podcast)

**Form (Left Column):**
- ✅ Multi-select categories
- ✅ Period selector (week or month)
- ✅ Item limit (1-50)
- ✅ Optional guidance prompt
- ✅ Generate button

**Results (Right Column):**

When generation completes, displays:

1. **Header Card**
   - Newsletter title
   - Generation timestamp
   - Stats: Items retrieved, Items included
   - Categories badges
   - Action buttons:
     - 📋 Copy Summary
     - ⬇️ Download Markdown
     - 📄 Download HTML

2. **Tabbed Content**
   - **Summary Tab**: Executive summary (100-150 words)
   - **Markdown Tab**: Full newsletter in markdown
   - **HTML Tab**: Styled HTML version for email
   - **Themes Tab**: Identified themes and topics
   - **Metadata Tab**: Generation details

---

## API Endpoints (Underlying)

If you want to call the APIs directly:

### Generate Podcast

```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["ai_news", "product_news"],
    "period": "week",
    "limit": 10,
    "voiceStyle": "conversational",
    "prompt": "Focus on code agents"
  }'
```

### Generate Newsletter

```bash
curl -X POST http://localhost:3002/api/newsletter/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["newsletters", "tech_articles"],
    "period": "week",
    "limit": 15,
    "prompt": "Emphasize developer productivity"
  }'
```

### Render Audio (Optional Post-Processing)

```bash
# First generate podcast transcript
TRANSCRIPT=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["ai_news"],"period":"week","limit":5}' | jq -r '.transcript')

# Then render to audio
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{
    \"transcript\": $(echo "$TRANSCRIPT" | jq -Rs .),
    \"provider\": \"openai\",
    \"voice\": \"nova\"
  }"
```

---

## Features & Capabilities

### Podcast Generation

| Feature | Status |
|---------|--------|
| Category selection | ✅ Fully implemented |
| Period selection (week/month) | ✅ Fully implemented |
| Voice style selection | ✅ Fully implemented |
| Optional prompt guidance | ✅ LLM-powered re-ranking |
| Transcript generation | ✅ GPT-4o-mini LLM |
| Segment parsing | ✅ Auto-segmented |
| Duration estimation | ✅ 150 wpm basis |
| Show notes generation | ✅ Markdown format |
| Transcript download | ✅ TXT export |
| Show notes download | ✅ Markdown export |
| Audio rendering | ✅ Optional `/render-audio` endpoint |

### Newsletter Generation

| Feature | Status |
|---------|--------|
| Category selection | ✅ Fully implemented |
| Period selection | ✅ Fully implemented |
| Optional prompt guidance | ✅ LLM-powered |
| Executive summary | ✅ 100-150 words |
| Full newsletter content | ✅ Markdown + HTML |
| Theme identification | ✅ LLM-extracted |
| Markdown download | ✅ Full export |
| HTML download | ✅ Email-ready format |

---

## Troubleshooting

### "No items available" Error

**Cause**: Database is empty or no items in selected categories

**Fix**:
```bash
# Sync daily to fetch fresh items
curl -X POST http://localhost:3002/api/admin/sync-daily
```

### Generation takes >10 seconds

**Cause**: LLM API is slow or there are many items to process

**What to do**:
- Wait, or reduce the item limit
- Check OpenAI API status

### Download buttons don't work

**Cause**: Browser might have blocked downloads

**Fix**:
- Right-click on the button and "Save link as..."
- Check browser console for errors: `F12 → Console`

### "Could not parse categories" Error

**Cause**: Invalid category was sent

**Fix**:
- Ensure selected categories are in: `newsletters`, `podcasts`, `tech_articles`, `ai_news`, `product_news`, `community`, `research`

---

## Advanced Usage

### Batch Generation Script

Generate multiple episodes with different configurations:

```bash
#!/bin/bash

# generate-batch.sh
# Generate podcasts for each category

CATEGORIES=("newsletters" "tech_articles" "ai_news" "product_news")
PERIOD="week"
LIMIT=10

for cat in "${CATEGORIES[@]}"; do
  echo "Generating podcast for: $cat"
  
  RESPONSE=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
    -H "Content-Type: application/json" \
    -d "{
      \"categories\": [\"$cat\"],
      \"period\": \"$PERIOD\",
      \"limit\": $LIMIT,
      \"voiceStyle\": \"conversational\"
    }")
  
  POD_ID=$(echo "$RESPONSE" | jq -r '.id')
  ITEMS=$(echo "$RESPONSE" | jq -r '.itemsIncluded')
  
  echo "✓ Generated: $POD_ID ($ITEMS items)"
done
```

Run it:
```bash
chmod +x generate-batch.sh
./generate-batch.sh
```

### Integration with External Systems

The synthesis endpoints return structured JSON suitable for:

- **Email newsletters**: Use the HTML output to send emails
- **Podcast platforms**: Use segments + transcript for podcast distribution
- **Notion/Slack**: Use markdown for posting to internal systems
- **Archival**: Store generation history in your database

---

## Architecture

```
UI Layer (React)
  ↓
SynthesisPage Component
  ├─ SynthesisForm (input)
  ├─ PodcastViewer / NewsletterViewer (output)
  └─ fetch() calls to API routes
  ↓
API Routes
  ├─ /api/podcast/generate
  ├─ /api/newsletter/generate
  └─ /api/podcast/render-audio (optional)
  ↓
Pipeline Services
  ├─ Database (item retrieval)
  ├─ Ranking (BM25 + LLM scores)
  ├─ Selection (diversity)
  ├─ LLM Synthesis (transcript/newsletter)
  └─ Audio Rendering (optional)
```

---

## Performance Notes

| Operation | Typical Time | Notes |
|-----------|--------------|-------|
| Podcast generation | 2–5s | Depends on item count & LLM |
| Newsletter generation | 2–5s | Faster than podcast (no segmentation) |
| Audio rendering | 1–3s | First request; cached requests <100ms |
| Full pipeline (generate + render) | 4–8s | Two sequential API calls |

---

## Next Steps

1. **Try the UI**: Navigate to `http://localhost:3000/synthesis/podcast`
2. **Generate an episode**: Select categories and click Generate
3. **Download results**: Use action buttons to export
4. **Optional**: Use `render-audio` endpoint to convert transcript to MP3
5. **Explore**: Try different voice styles and prompts

For testing commands, see `PODCAST_TESTING_GUIDE.md`.

