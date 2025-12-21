# Podcast Generation: Four-Stage Pipeline

## Overview

The podcast generation system now uses a **four-stage pipeline** that mirrors the newsletter's two-pass extraction + synthesis model, with enhanced editorial control and verification:

1. **Stage A (Digest)**: Per-item extraction with structured podcast schema
2. **Stage B (Rundown)**: Editorial clustering, time budgeting, thematic organization
3. **Stage C (Script)**: Conversational HOST + COHOST script writing
4. **Stage D (Verify)**: Accuracy audit and claim verification

Target: **5–10 minutes** (~750–1500 words at 150 wpm), tech-podcast vibe, evidence-first tone.

---

## Architecture

### Files

```
src/lib/pipeline/
├── podcastDigest.ts      # Stage A: gpt-5.2 per-item extraction
├── podcastRundown.ts     # Stage B: gpt-5.2-pro editorial clustering
├── podcastScript.ts      # Stage C: gpt-5.2-pro conversational script
├── podcastVerify.ts      # Stage D: gpt-5.2 fact-check/verification
└── podcast.ts            # Legacy fallback (still used for segment parsing)

app/api/podcast/generate/
└── route.ts              # Main endpoint wiring all four stages
```

### API Endpoint

**POST /api/podcast/generate**

**Request:**
```json
{
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "limit": 10,
  "prompt": "Focus on code search and agents",
  "voiceStyle": "conversational"
}
```

**Response:**
```json
{
  "id": "pod-<uuid>",
  "title": "Code Intelligence Digest – Week of ...",
  "generatedAt": "2025-12-21T...",
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "duration": "8:45",
  "itemsRetrieved": 42,
  "itemsIncluded": 8,
  "transcript": "[INTRO MUSIC]\n\n**HOST:** ...",
  "segments": [
    {
      "title": "Code Search Tooling",
      "startTime": "0:45",
      "endTime": "2:30",
      "duration": 105
    }
  ],
  "showNotes": "# Show Notes\n\n## Sources & Attribution\n\n...",
  "generationMetadata": {
    "promptUsed": "Focus on code search and agents",
    "modelUsed": "gpt-5.2-instant (digest) + gpt-5.2-thinking (rundown/verify) + gpt-5.2-pro (script)",
    "tokensUsed": 5200,
    "voiceStyle": "conversational",
    "duration": "32.5s",
    "promptProfile": { "focusTopics": ["code-search", "agents"], ... },
    "pipelineStages": {
      "digestExtraction": true,
      "rundownGeneration": true,
      "scriptWriting": true,
      "verification": {
        "passed": true,
        "issueCount": 2,
        "errorCount": 0,
        "report": "# Verification Report\n\nWarnings: ..."
      }
    }
  }
}
```

---

## Stage A: Digest Extraction (gpt-5.2)

**File:** `src/lib/pipeline/podcastDigest.ts`

**Function:** `extractPodcastItemDigest(item, userPrompt)`

**Model:** `gpt-5.2` (parallel, efficient, structured JSON output)

### Per-Item Schema

```typescript
interface PodcastItemDigest {
  id: string;
  title: string;
  source_name: string;
  url: string;
  published_at: string;
  
  one_sentence_gist: string;           // 1-2 sentence summary
  key_facts: string[];                 // 3-6 factual bullets
  what_changed: string;                // What's new vs baseline
  who_affected: string[];              // Users, devs, companies
  uncertainty_or_conflicts: string[];  // Disagreements or unknowns
  one_line_takeaway: string;           // Practical implication
  soundbite_lines: string[];           // 2-4 short lines for audio
  credibility_notes: string;           // "high" / "medium" / "low" + reason
  relevance_to_focus?: number;         // 0-10 match with user prompt
}
```

### Processing

- **Input**: Ranked items (from selection pipeline)
- **Auto-chunking**: Long articles split at 2000 chars + sentence boundaries
- **Parallel extraction**: All items processed concurrently
- **Fallback**: If API unavailable, uses summary + LLM tags

### Key Rules

- `key_facts` MUST be factual—no speculation
- If unclear, goes into `uncertainty_or_conflicts`
- `soundbite_lines` are short (<60 chars) and natural to read aloud
- `credibility_notes` distinguish academic/official vs established vs casual

---

## Stage B: Rundown Generation (gpt-5.2-pro)

**File:** `src/lib/pipeline/podcastRundown.ts`

**Function:** `generatePodcastRundown(digests, period, categories, profile)`

**Model:** `gpt-5.2-pro` (editorial reasoning: story selection, clustering, time budgeting)

### Rundown Schema

```typescript
interface PodcastRundown {
  episode_title: string;
  cold_open: string;                  // 2-3 sentence hook
  segments: PodcastSegment[];         // Max 4
  lightning_round: PodcastLightningRound[];  // 3 tiny items
  cut_list: string[];                 // Stories not covered
  attribution_plan: Array<{
    url: string;
    spoken_attribution: string;
  }>;
  total_time_seconds: number;         // 300-600 seconds
}
```

### Editorial Decisions

- **Story selection**: Picks 3–5 stories (max 4 segments)
- **Clustering**: Groups by theme, not source
- **Time budgeting**: 90–120s per main segment, 30–60s lightning round
- **Ordering**: For comprehension and narrative flow
- **Attribution**: Plans how to cite each source aloud
- **Cut list**: Explains what's not covered and why

### Key Rules

- Prefer high-credibility and high-relevance items (from Stage A)
- No hype language ("game-changer", "this is insane")
- Measured verbs: "suggests", "indicates", "reports"
- Total target: 300–600 seconds (5–10 minutes)

---

## Stage C: Script Writing (gpt-5.2-pro)

**File:** `src/lib/pipeline/podcastScript.ts`

**Function:** `generatePodcastScript(digests, rundown, period, categories, profile, voiceStyle)`

### Script Output

```markdown
[INTRO MUSIC]

**HOST:** Welcome to...

**COHOST:** Today we're covering...

## [0:45] Code Search Tooling

**HOST:** Let's start with fact one. Fact two. And fact three.

**COHOST:** That said, there's some uncertainty here: ...

[PAUSE]

**HOST:** Here's why it matters: ...

## [2:30] Next Topic

...

**HOST:** Thanks for listening. Show notes below...

[OUTRO MUSIC]
```

### Script Segments

```typescript
interface PodcastSegment {
  title: string;
  startTime: string;     // "0:45"
  endTime: string;       // "2:30"
  duration: number;      // 105 seconds
}
```

### Tone Requirements (Critical)

- **No hype**: No "tech bro" swagger, no dunking
- **Measured language**: "suggests" not "confirms", "indicates" not "proves"
- **Separation of facts/opinions**: "What we know" vs "What we think" vs "What we're unsure about"
- **Warmth + clarity**: Curiosity, not cleverness
- **Facts substantiated**: Every claim has audible attribution
- **Natural speech**: Short sentences, contractions OK, conversational

### Timing Targets

- 0:00–0:20: Intro music
- 0:20–0:45: Cold open hook
- 0:45–1:15: Intro (3 bullets on what's coming)
- 1:15–8:30: Main segments (90–150s each, 3–4 segments)
- 8:30–9:30: Lightning round (optional, 60–90s)
- 9:30–10:00: Outro (recap + show notes pointer)

---

## Stage D: Fact-Check Verification (gpt-5.2)

**File:** `src/lib/pipeline/podcastVerify.ts`

**Function:** `verifyPodcastScript(script, digests)`

**Model:** `gpt-5.2` (structured fact-check audit: flags unsupported claims, missing attribution)

### Verification Output

```typescript
interface VerificationIssue {
  type: "unsupported_claim" | "missing_attribution" | "overconfident_language" | "factual_error";
  line: string;              // Exact quote from script
  issue: string;             // Description of problem
  suggested_fix: string;     // How to fix
  severity: "error" | "warning";
}

interface VerificationResult {
  script: string;            // Corrected script
  issues: VerificationIssue[];
  passedVerification: boolean;
  notes: string;
}
```

### Checks

1. **Unsupported claims**: Any factual statement not backed by digest flagged as `[NEEDS SUPPORT]`
2. **Missing attribution**: Factual claims without audible attribution
3. **Overconfident language**: "confirms"/"proves" when source only "suggests"/"reports"
4. **Internal contradictions**: Script vs digest disagreements
5. **Opinion clarity**: Opinions must be labeled ("I think", "suggests", "could indicate")

### Output

- Corrected script with `[NEEDS SUPPORT]` markers
- List of errors (must fix) and warnings (should fix)
- Verification report in markdown

---

## Integration in API Route

**File:** `app/api/podcast/generate/route.ts`

**Flow:**

```
Request → Validate → Retrieve items → Rank items → Select with diversity
  ↓
Stage A: Extract digests for all selected items (parallel)
  ↓
Stage B: Generate rundown (editorial clustering)
  ↓
Stage C: Write conversational script (facts-first tone)
  ↓
Stage D: Verify script against digests
  ↓
Build show notes from rundown + digests
  ↓
Response with metadata (pipeline stages, verification results)
```

### Key Helpers

**`buildShowNotes(digests, rundown)`**: Constructs markdown show notes with:
- Sources & attribution section
- Segments section (grouped by theme)
- Lightning round (if present)
- All items as reference list

---

## Tone Specification

### Measured Language

| ❌ Avoid | ✅ Use |
|---------|--------|
| confirms | suggests, indicates |
| proves | reports, shows evidence |
| game-changer | interesting development |
| insane | notable, significant |
| definitely | likely, probably |
| This changes everything | This adds to the conversation |

### Structure (Facts → Why → Uncertainty)

```
FACTS:
"According to [source], [fact 1]. [Fact 2]. [Fact 3]."

WHY IT MATTERS:
"Here's what this means: [practical implication]."

UNCERTAINTY:
"That said, [what we don't know] / [what sources disagree about]."
```

### Attribution Examples

**Good:**
- "According to the Pragmatic Engineer post..."
- "The OpenAI documentation shows..."
- "Researchers at Stanford report that..."
- "GitHub's release notes indicate..."

**Bad:**
- "Everyone knows..."
- "Obviously..."
- "It's clear that..." (without source)

---

## User Prompt Integration

The system uses **`PromptProfile`** from `promptProfile.ts`:

```typescript
interface PromptProfile {
  focusTopics: string[];       // ["code-search", "agents"]
  excludeTopics?: string[];    // Topics to filter out
}
```

**Applied in:**

1. **Stage A**: Digests compute `relevance_to_focus` (0–10)
2. **Stage B**: Rundown favors high-relevance items for story selection
3. **Stage C**: Script explicitly references user focus in prompt
4. **Overall**: Re-ranking during selection (before digests)

---

## Fallback Strategies

### If OPENAI_API_KEY not set:
- Stage A: Uses `generateFallbackPodcastDigest()` (gist + first summary)
- Stage B: Uses `generateFallbackRundown()` (top 4 digests, basic clustering)
- Stage C: Uses `generateFallbackScript()` (simple HOST/COHOST alternation)
- Stage D: Skipped (no verification)

### If LLM fails mid-pipeline:
- Each stage has try/catch with fallback
- Verification always attempts; if it fails, script is used as-is with warning

---

## Testing & Iteration

### Manual Testing

```bash
# Test the endpoint
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["tech_articles"],
    "period": "week",
    "limit": 5,
    "prompt": "Code search and agents",
    "voiceStyle": "conversational"
  }'
```

### Audit Verification Results

The `pipelineStages.verification` object in metadata includes:
- `passed`: Boolean (true if no errors)
- `issueCount`: Total issues found
- `errorCount`: Errors only (must fix)
- `report`: Full markdown verification report

### Key Metrics

- **Duration**: Total wall-clock time for all 4 stages (see `generationMetadata.duration`)
- **Token estimate**: Rough cost (fine-tuned per model after launch)
- **Verification pass rate**: Monitor `passedVerification` in logs

---

## Prompt Templates

### Stage A: Per-Item Digest

Located in `podcastDigest.ts`, embedded in `extractPodcastItemDigest()`. Requires:
- `gpt-5.2`, `max_tokens: 1000`
- Strict JSON output
- Rules for factual accuracy, uncertainty notation, soundbite naturalness
- Auto-chunks long articles (2000 chars) to reduce hallucination

### Stage B: Rundown

Located in `podcastRundown.ts`. Requires:
- `gpt-5.2-pro`, `max_tokens: 8000`
- Story selection (3–5 max), clustering by theme, time budgeting, attribution planning
- Rules for tone (no hype) and constraints (300–600s total, 4 segments max)
- Returns structured JSON with segments, time_seconds, transitions, cut_list

### Stage C: Script

Located in `podcastScript.ts`. Requires:
- `gpt-5.2-pro`, `max_tokens: 5000`
- **CRITICAL**: Full rundown structure embedded (segments with time_seconds budgets)
- Conversational HOST + COHOST markdown with [MM:SS] segment markers
- Facts-first structure, audible attribution, measured language
- Target: 750–1500 words for 5–10 minutes at 150 wpm
- Each segment MUST fit time budget (±5s tolerance)

### Stage D: Fact-Check Verification

Located in `podcastVerify.ts`. Requires:
- `gpt-5.2`, `max_tokens: 6000`
- **STRICT audit**: Every factual claim traceable to digest fact
- Flags unsupported claims as `[NEEDS SUPPORT]`, missing attribution, overconfident tone
- Returns JSON with issues (line, issue, suggested_fix, severity)
- Includes corrected_script with markers and error_count/warning_count

---

## Next Steps

1. **Launch**: Deploy and monitor verification pass rates
2. **Iterate**: Adjust tone prompts based on early feedback
3. **Optimize**: Fine-tune time budgets per segment (currently 90–150s)
4. **Analytics**: Track user engagement (clicks, shares, listen time)
5. **Extend**: Add guest voices, segment transitions, music cues (Stage C enhancement)

---

## Related

- **Newsletter**: `src/lib/pipeline/extract.ts` + `newsletter.ts` (two-pass model)
- **UI**: `app/(synthesis)/podcast` (dark theme, back button, tabs for transcript/segments/notes)
- **Config**: `src/config/categories.ts` (category weights, queries, half-lives)
