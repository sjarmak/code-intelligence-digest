# Technical Reference for Newsletter/Podcast Agent

## Type Definitions

From `src/lib/model.ts`:

```typescript
export type Category = 
  | "newsletters"
  | "podcasts"
  | "tech_articles"
  | "ai_news"
  | "product_news"
  | "community"
  | "research";

export interface FeedItem {
  id: string;
  streamId: string;
  sourceTitle: string;
  title: string;
  url: string;
  author?: string;
  publishedAt: Date;
  summary?: string;       // FULL summary, use this
  contentSnippet?: string; // First 500 chars (optional)
  categories: string[];
  category: Category;
  raw: Record<string, unknown>;
}

export interface RankedItem extends FeedItem {
  bm25Score: number;      // 0-1
  llmScore: {
    relevance: number;    // 0-10
    usefulness: number;   // 0-10
    tags: string[];       // ["code-search", "agents", "context", ...]
  };
  recencyScore: number;   // 0-1
  finalScore: number;     // 0-1 (combined)
  reasoning: string;      // "LLM: relevance=8.5, usefulness=7.2 | BM25=0.82 | ..."
}
```

---

## API Routes to Implement

### 1. Newsletter Generation

**Endpoint**: `POST /api/newsletter/generate`

**Request**:
```typescript
interface NewsletterRequest {
  categories: Category[];
  period: "day" | "week" | "month";
  limit: number;           // How many items to retrieve (1-50)
  prompt: string;          // Custom user prompt for alignment
}
```

**Response**:
```typescript
interface NewsletterResponse {
  id: string;              // Generated UUID
  title: string;           // "Code Intelligence Digest – Week of Jan 20"
  generatedAt: string;     // ISO timestamp
  categories: Category[];
  period: string;
  itemsRetrieved: number;
  itemsIncluded: number;   // After filtering
  summary: string;         // 100-150 word executive summary
  markdown: string;        // Full markdown output
  html: string;            // Full HTML output
  themes: string[];        // Top 5-10 extracted themes
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;     // "gpt-4o"
    tokensUsed: number;
    duration: string;      // "3.2s"
  };
}
```

**Implementation Flow**:
```typescript
export async function generateNewsletter(req: NewsletterRequest): Promise<NewsletterResponse> {
  // 1. Load items from database
  const items = await loadItemsByCategory(req.categories[0], periodToDays(req.period));
  
  // 2. Filter by categories (if multiple)
  let filtered = items.filter(i => req.categories.includes(i.category));
  
  // 3. Rank items
  let ranked = await rankCategory(filtered, req.categories[0], periodToDays(req.period));
  
  // 4. RE-RANK by prompt alignment
  ranked = rerankByPrompt(ranked, req.prompt);
  
  // 5. Apply diversity selection
  const selected = selectWithDiversity(ranked, req.categories[0], 2, req.limit);
  
  // 6. Generate content
  const themes = extractThemes(selected.items);
  const summary = await generateSummaryWithPrompt(selected.items, req.prompt);
  const markdown = formatNewsletterMarkdown(selected.items, themes, req.prompt);
  const html = formatNewsletterHTML(selected.items, themes, req.prompt);
  
  // 7. Return structured response
  return {
    id: generateUUID(),
    title: `Code Intelligence Digest – ${periodLabel(req.period)}`,
    generatedAt: new Date().toISOString(),
    categories: req.categories,
    period: req.period,
    itemsRetrieved: ranked.length,
    itemsIncluded: selected.items.length,
    summary,
    markdown,
    html,
    themes: getTopThemes(themes, 10),
    generationMetadata: { ... }
  };
}
```

**Key Functions to Implement**:
1. `rerankByPrompt(items: RankedItem[], prompt: string): RankedItem[]`
2. `generateSummaryWithPrompt(items: RankedItem[], prompt: string): Promise<string>`
3. `formatNewsletterMarkdown(items: RankedItem[], themes: string[], prompt: string): string`
4. `formatNewsletterHTML(items: RankedItem[], themes: string[], prompt: string): string`

---

### 2. Podcast Generation

**Endpoint**: `POST /api/podcast/generate`

**Request**:
```typescript
interface PodcastRequest {
  categories: Category[];
  period: "day" | "week" | "month";
  limit: number;
  prompt: string;
  format: "transcript" | "markdown" | "json";
  voiceStyle?: "conversational" | "formal" | "casual";
}
```

**Response**:
```typescript
interface PodcastResponse {
  id: string;
  title: string;
  generatedAt: string;
  categories: Category[];
  period: string;
  duration: string;        // "18:45" (estimated)
  itemsRetrieved: number;
  itemsIncluded: number;
  transcript: string;      // Full podcast transcript
  segments: PodcastSegment[];
  showNotes: string;       // Markdown with references
  generationMetadata: {
    promptUsed: string;
    modelUsed: string;
    tokensUsed: number;
    voiceStyle: string;
    duration: string;      // Generation time
  };
}

interface PodcastSegment {
  title: string;           // e.g., "Segment 1: Code Search Breakthroughs"
  startTime: string;       // "0:30"
  endTime: string;         // "7:20"
  duration: number;        // Seconds
  summary: string;
  itemsReferenced: Array<{
    title: string;
    url: string;
    sourceTitle: string;
  }>;
  highlights: string[];    // Key quotes or insights
  speaker?: string;        // "Host" | "Expert" | "Co-host"
}
```

**Implementation Flow**:
```typescript
export async function generatePodcast(req: PodcastRequest): Promise<PodcastResponse> {
  // 1. Load and rank items (same as newsletter)
  const items = await loadAndRankItems(req.categories, req.period, req.limit);
  const reranked = rerankByPrompt(items, req.prompt);
  const selected = selectWithDiversity(reranked, req.categories[0], 2, req.limit);
  
  // 2. Extract podcast topics/segments
  const topics = extractPodcastTopics(selected.items);
  
  // 3. Generate transcript with dialogue
  const transcript = await generateTranscript(topics, req.prompt, req.voiceStyle);
  
  // 4. Segment transcript and link to source items
  const segments = segmentAndLinkTranscript(transcript, selected.items);
  
  // 5. Generate show notes
  const showNotes = generateShowNotes(selected.items, segments);
  
  // 6. Estimate duration (rough: ~130 words per minute for podcast speech)
  const duration = estimateDuration(transcript);
  
  return {
    id: generateUUID(),
    title: `Code Intelligence Weekly – Episode ${episodeNumber()}`,
    generatedAt: new Date().toISOString(),
    categories: req.categories,
    period: req.period,
    duration,
    itemsRetrieved: reranked.length,
    itemsIncluded: selected.items.length,
    transcript,
    segments,
    showNotes,
    generationMetadata: { ... }
  };
}
```

**Key Functions to Implement**:
1. `extractPodcastTopics(items: RankedItem[]): Topic[]`
2. `generateTranscript(topics: Topic[], prompt: string, voiceStyle: string): Promise<string>`
3. `segmentAndLinkTranscript(transcript: string, items: RankedItem[]): PodcastSegment[]`
4. `generateShowNotes(items: RankedItem[], segments: PodcastSegment[]): string`

---

## Prompt Alignment Algorithm (Core)

The key differentiator is re-ranking by user prompt:

```typescript
interface PromptAlignment {
  promptTerms: string[];        // ["practical", "enterprise", "productivity"]
  domainTerms: string[];        // ["code-search", "agents", "context"]
  intentType: string;           // "technical" | "business" | "practical" | "research"
}

function parsePrompt(prompt: string): PromptAlignment {
  // Extract key terms: nouns + important adjectives
  // Match against known domain terms
  // Infer intent from prompt language
  const terms = extractKeywords(prompt);
  const domainMatches = terms.filter(t => isDomainTerm(t));
  
  return {
    promptTerms: terms,
    domainTerms: domainMatches,
    intentType: inferIntent(prompt)
  };
}

function scoreItemForPrompt(
  item: RankedItem,
  alignment: PromptAlignment
): number {
  let score = item.finalScore * 0.5; // Start with baseline
  
  // 1. LLM tag overlap (40%)
  const tagMatches = item.llmScore.tags.filter(tag =>
    alignment.domainTerms.some(dt =>
      tag.toLowerCase().includes(dt) || dt.includes(tag.toLowerCase())
    )
  ).length;
  const tagScore = Math.min(tagMatches / alignment.domainTerms.length, 1.0);
  score += tagScore * 0.4;
  
  // 2. Summary term density (10%)
  const summaryText = (item.summary || "").toLowerCase();
  const termMatches = alignment.promptTerms.filter(t =>
    summaryText.includes(t.toLowerCase())
  ).length;
  const termScore = Math.min(termMatches / alignment.promptTerms.length, 1.0);
  score += termScore * 0.1;
  
  return Math.min(score, 1.0);
}

function rerankByPrompt(
  items: RankedItem[],
  prompt: string
): RankedItem[] {
  const alignment = parsePrompt(prompt);
  
  const scored = items.map(item => ({
    item,
    score: scoreItemForPrompt(item, alignment)
  }));
  
  return scored
    .sort((a, b) => b.score - a.score)
    .map(s => ({
      ...s.item,
      finalScore: s.score, // Update final score for re-ranked items
      reasoning: `${s.item.reasoning} | Prompt aligned: ${s.score.toFixed(2)}`
    }));
}
```

---

## Existing Code to Extend

### Template: Answer Generation
**File**: `src/lib/pipeline/answer.ts`

```typescript
// Already implements:
// 1. Retrieve relevant items
// 2. Format as context
// 3. Call LLM with prompt
// 4. Return structured response
// 5. Error handling + fallback

// Key functions to learn from:
export async function generateAnswer(query: string, items: RankedItem[]): Promise<string>
export function formatItemsAsContext(items: RankedItem[]): string
```

### Template: Digest Generation
**File**: `src/lib/pipeline/digest.ts`

```typescript
// Already implements:
// 1. Theme extraction
// 2. LLM summary generation
// 3. Markdown formatting

// Key functions to learn from:
export function extractThemes(items: RankedItem[]): Map<string, number>
export async function generateDigestSummary(themes: string[], itemCount: number, periodLabel: string): Promise<string>
```

---

## Database Queries

### Load Items by Category (for both features)

```typescript
import { loadItemsByCategory } from "@/src/lib/db/items";

const items = await loadItemsByCategory(category, periodDays);
// Returns: FeedItem[]
```

### Load Ranked Items

```typescript
import { rankCategory } from "@/src/lib/pipeline/rank";

const ranked = await rankCategory(items, category, periodDays);
// Returns: RankedItem[] (already scored + ranked)
```

### Apply Diversity Selection

```typescript
import { selectWithDiversity } from "@/src/lib/pipeline/select";

const selection = selectWithDiversity(ranked, category, maxPerSource, maxItems);
// Returns: { items: RankedItem[], reasons: Map<string, string> }
```

---

## LLM Prompting Patterns

### For Newsletter Generation

```typescript
const systemPrompt = `You are an expert technical writer creating a weekly digest newsletter for senior engineers and technical leaders. 
The newsletter should be:
- Concise and actionable (avoid fluff)
- Well-organized by theme
- Include practical insights and recommendations
- Link to original sources

Format output as markdown with clear structure.`;

const userPrompt = `Create a newsletter based on the following curated content. 
User's focus: ${userPrompt}

Items:
${items.map(i => `- ${i.title} (from ${i.sourceTitle}): ${i.summary}`).join('\n\n')}

Generate a newsletter that:
1. Opens with a 100-150 word summary aligned to: "${userPrompt}"
2. Organizes items by theme
3. For each item, provide 1-2 sentence summary with link
4. Close with 3 key takeaways
5. Include "Why This Matters" section`;
```

### For Podcast Generation

```typescript
const systemPrompt = `You are a podcast script writer creating engaging, natural dialogue for technical podcasts.
Style should be: ${voiceStyle}
- Use natural language and conversational flow
- Include transitions between topics
- Reference sources naturally
- Break content into segments (~1-2 minutes each)
- Add [MUSIC] and [PAUSE] cues for audio`;

const userPrompt = `Create a podcast transcript based on the following content.
Target audience: ${prompt}

Topics:
${topics.map(t => `- ${t.title}: ${t.summary}`).join('\n\n')}

Generate a ${targetDuration}-minute podcast that:
1. Opens with engaging intro (30 seconds)
2. Covers each topic with natural dialogue (5-7 min each)
3. References sources naturally
4. Closes with key takeaways and show notes reference
5. Includes speaker changes and transitions`;
```

---

## Error Handling

```typescript
try {
  // Generate content
} catch (error) {
  logger.error("Newsletter generation failed", { error });
  
  if (error instanceof APIError) {
    // LLM API failure
    return fallbackNewsletter(items);
  } else if (error instanceof ValidationError) {
    // Invalid input
    throw new BadRequestError(error.message);
  } else {
    // Unknown error
    throw new InternalServerError("Failed to generate newsletter");
  }
}

function fallbackNewsletter(items: RankedItem[]): NewsletterResponse {
  // Return simple formatted list if LLM fails
  return {
    ...baseResponse,
    markdown: formatSimpleList(items),
    html: formatSimpleListHTML(items)
  };
}
```

---

## Testing Checklist

- [ ] Accept valid request with all required fields
- [ ] Accept request with optional fields (voiceStyle, etc.)
- [ ] Reject invalid categories
- [ ] Reject invalid periods
- [ ] Validate limit is 1-50
- [ ] Generate content <10 seconds
- [ ] Include proper source attribution
- [ ] Include generation metadata
- [ ] Handle missing summaries gracefully
- [ ] Fallback if LLM fails
- [ ] Format output correctly (markdown/HTML)
- [ ] Re-rank by prompt alignment correctly

---

## Example Usage

**Newsletter Request**:
```json
{
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "limit": 20,
  "prompt": "Focus on practical applications for teams building code search tools. Emphasize architectural patterns and performance optimizations."
}
```

**Podcast Request**:
```json
{
  "categories": ["podcasts", "research"],
  "period": "week",
  "limit": 15,
  "prompt": "Create an engaging discussion about recent breakthroughs in AI-assisted code generation and semantic search. Target software engineers.",
  "format": "transcript",
  "voiceStyle": "conversational"
}
```

---

## Summary

**Newsletter**:
- Retrieve top items for categories + period
- Re-rank by prompt alignment
- Generate markdown + HTML with themes
- Include executive summary + item descriptions

**Podcast**:
- Retrieve top items for categories + period
- Re-rank by prompt alignment
- Extract topics and generate natural dialogue
- Segment and link to sources in show notes

**Core Algorithm**: Parse user prompt → extract key terms → match against item LLM tags + domain terms → re-rank by alignment → generate LLM output aligned to intent.

All supporting infrastructure is in place. Ready to implement! 🚀
