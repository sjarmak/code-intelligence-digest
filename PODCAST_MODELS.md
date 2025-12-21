# Podcast Pipeline: Model Configuration

## Four-Stage Model Usage

| Stage | Task | Model | Max Tokens | Notes |
|-------|------|-------|------------|-------|
| **A** | Per-item digest extraction | `gpt-5.2` | 1000 | Parallel, structured JSON; auto-chunks long articles |
| **B** | Editorial clustering + rundown | `gpt-5.2-pro` | 8000 | Story selection, time budgeting, thematic clustering |
| **C** | Conversational script writing | `gpt-5.2-pro` | 5000 | Facts-first HOST+COHOST; respects rundown time budgets |
| **D** | Fact-check verification | `gpt-5.2` | 6000 | Strict audit: flags unsupported claims, missing attribution |

---

## Why This Model Split?

### Stage A: `gpt-5.2`
- **Efficiency**: Extract 5–10 items in parallel
- **Structured output**: Strict JSON schema (gist, key_facts, soundbites, etc.)
- **Hallucination control**: Fixed schema + chunking reduces false claims

### Stage B: `gpt-5.2-pro`
- **Editorial reasoning**: Story selection (3–5 best) from 10+ candidates
- **Clustering logic**: Group by theme, decide segment order for narrative flow
- **Time budgeting**: Allocate seconds to segments while respecting 5–10 min total

### Stage C: `gpt-5.2-pro`
- **Quality prose**: Conversational script needs fluidity + depth
- **Embedding rundown**: Full structure (segments, time_seconds, transitions) embedded in prompt
- **Tone consistency**: Measured language, natural attribution, no hype—requires sophisticated generation

### Stage D: `gpt-5.2`
- **Structured audit**: Fixed JSON schema for issues (type, line, suggested_fix, severity)
- **Ground truth comparison**: Script vs. digests fact-check (deterministic checks)
- **Cost efficiency**: Verification is cheaper than original generation

---

## Prompt Strength: Rundown → Script Handoff

**Critical:** Stage C prompt embeds full rundown structure so script respects time budgets.

```
Segments:
${rundown.segments
  .map(
    (s, idx) => `
${idx + 1}. ${s.name} (${s.time_seconds}s)
   Key points: ${s.key_points_to_say.join("; ")}
   Uncertainty: ${s.nuance_or_uncertainty.join("; ") || "None"}
   Transition: "${s.transition_line}"
`
  )
  .join("")}
```

**Script must:**
- Include segment markers: `[0:45] Segment Name`
- Fit each segment within time_seconds (±5s tolerance)
- Use provided transition_line between segments
- Target 150 wpm (word count / 150 = minutes)

---

## Verification Pipeline: Strict Fact-Check

Stage D uses a **STRICT audit prompt** that:

1. **Traces every factual claim** to a digest key_fact
2. **Marks unsupported claims** with `[NEEDS SUPPORT]` for manual review
3. **Checks attribution**: Every fact needs "According to [source]..."
4. **Downgrades tone**: "confirms" → "suggests" (unless primary source)
5. **Separates opinion**: Must use "I think", "likely", "suggests" (not "is")

**Severity:**
- **ERROR**: Unsupported claim, missing attribution, contradiction
- **WARNING**: Overconfident tone, missing nuance

**Pass criteria:** Zero errors (warnings OK)

---

## API Metadata

Response includes:
```json
"generationMetadata": {
  "modelUsed": "gpt-5.2 (digest) + gpt-5.2-pro (rundown) + gpt-5.2-pro (script) + gpt-5.2 (fact-check)",
  "pipelineStages": {
    "digestExtraction": true,
    "rundownGeneration": true,
    "scriptWriting": true,
    "verification": {
      "passed": boolean,
      "issueCount": number,
      "errorCount": number,
      "report": string
    }
  }
}
```

---

## Token Cost Estimate

For a typical 8-minute episode (10 items, 1200 words):

- **Stage A**: 10 items × 300 tokens ≈ **3,000 tokens** (gpt-5.2)
- **Stage B**: 1,500 tokens for rundown ≈ **1,500 tokens** (gpt-5.2-pro)
- **Stage C**: 1,200 words ≈ **2,000 tokens** (gpt-5.2-pro)
- **Stage D**: 1,200 words + digests ≈ **2,000 tokens** (gpt-5.2)

**Total: ~8,500 tokens** (rough estimate; actual varies by model pricing)

---

## Configuration & Fallbacks

- If `OPENAI_API_KEY` not set: All stages use fallback templates (no LLM calls)
- If stage fails mid-pipeline: Fallback used, error logged, pipeline continues
- Verification always runs (even if script failed); if verify fails, script used as-is with warning

---

## Next Steps

1. Monitor token usage per stage (adjust max_tokens if needed)
2. Track verification pass rate (aim for >90%)
3. Iterate on fact-check prompt if false positives emerge
4. A/B test rundown clustering (adjust story selection criteria)
