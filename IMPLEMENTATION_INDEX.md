# Implementation Index

Quick reference for all phases, documents, and commands.

## Phases Overview

### Phase 1: BM25 Ranking ✅
- **Bead**: code-intel-digest-9gx
- **Status**: Complete
- **Docs**: `history/PHASE1_BM25_SCORING.md` (if exists)
- **Files**: `src/lib/pipeline/bm25.ts`
- **Test**: `npx tsx scripts/test-bm25.ts`

### Phase 2: LLM Scoring ✅
- **Bead**: code-intel-digest-06q
- **Status**: Complete
- **Docs**: `history/PHASE2_LLM_SCORING.md` (if exists)
- **Files**: `src/lib/pipeline/llmScore.ts`
- **Test**: `npx tsx scripts/test-llm-score.ts`

### Phase 3: Hybrid Ranking ✅
- **Bead**: code-intel-digest-phj
- **Status**: Complete
- **Docs**: `history/PHASE3_MERGE_SCORING.md`
- **Files**: `src/lib/pipeline/rank.ts`, `app/api/items/route.ts`
- **Test**: `npx tsx scripts/test-ranking.ts`

### Phase 4: Diversity Selection ✅
- **Bead**: code-intel-digest-8hc
- **Status**: Complete
- **Docs**: `history/PHASE4_DIVERSITY_SELECTION.md`
- **Session Summary**: `SESSION_PHASE4_SUMMARY.md`
- **Files**: `src/lib/pipeline/select.ts`, `app/api/items/route.ts` (updated)
- **Test**: `npx tsx scripts/test-diversity.ts`

### Phase 5: UI Components ⏳
- **Bead**: code-intel-digest-htm
- **Status**: Not Started
- **Planning**: `NEXT_SESSION_PHASE5.md` (comprehensive templates)
- **Components**:
  - `app/components/digest/item-card.tsx`
  - `app/components/digest/items-grid.tsx`
  - `app/components/digest/category-tabs.tsx`
  - `app/components/digest/period-selector.tsx`
  - `app/page.tsx` (updated)

## Key Documents

| Document | Purpose | Key Info |
|----------|---------|----------|
| `AGENTS.md` | Global guidelines | Commands, patterns, ACE framework |
| `RANKING_STATUS.md` | Current progress | 90% complete (4/5 phases) |
| `history/PHASE3_MERGE_SCORING.md` | Phase 3 results | Hybrid ranking working, finalScore [0-1] |
| `history/PHASE4_DIVERSITY_SELECTION.md` | Phase 4 results | Per-source caps enforced, 7/7 categories ✅ |
| `SESSION_PHASE4_SUMMARY.md` | This session | What was done, test results, findings |
| `NEXT_SESSION_PHASE5.md` | Next phase plan | Comprehensive UI implementation guide |

## Architecture Overview

```
Raw Items → Normalize → BM25 Score → LLM Score → Hybrid Rank → Diversity Select → API → UI
  (8,058)    (Phase 1)   (Phase 1)   (Phase 2)   (Phase 3)      (Phase 4)         ✅    ⏳
```

## API Endpoint

**Endpoint**: `GET /api/items`

**Parameters**:
```
?category=tech_articles&period=week
```

Valid categories:
- newsletters, podcasts, tech_articles, ai_news, product_news, community, research

Valid periods:
- week (7 days), month (30 days), all (90 days)

**Response Example**:
```json
{
  "category": "tech_articles",
  "period": "week",
  "totalItems": 6,
  "itemsRanked": 281,
  "itemsFiltered": 275,
  "items": [
    {
      "id": "...",
      "title": "Java Annotated Monthly – December 2025",
      "url": "https://...",
      "sourceTitle": "JetBrains Company Blog",
      "publishedAt": "2025-12-05T10:30:15.000Z",
      "finalScore": 0.835,
      "llmScore": {
        "relevance": 10,
        "usefulness": 9.4,
        "tags": ["agent", "devex", "devops"]
      },
      "diversityReason": "Selected at rank 1"
    }
  ]
}
```

## Testing Commands

### Quality Gates
```bash
npm run typecheck      # TypeScript validation
npm run lint          # ESLint validation
npm run build         # Production build (note: pre-existing React issue in global-error)
```

### Ranking Pipeline Tests
```bash
npx tsx scripts/test-bm25.ts           # BM25 scoring validation
npx tsx scripts/test-llm-score.ts      # LLM scoring validation
npx tsx scripts/test-ranking.ts        # Hybrid ranking validation (35/35 ✅)
npx tsx scripts/test-api-items.ts      # API endpoint integration test
npx tsx scripts/test-diversity.ts      # Diversity selection test (7/7 ✅)
```

### Database Queries
```bash
# View items by category
sqlite3 .data/digest.db "SELECT category, COUNT(*) FROM items GROUP BY category;"

# View item scores
sqlite3 .data/digest.db "SELECT COUNT(*) as count, AVG(bm25_score) FROM item_scores;"

# Check item with highest score
sqlite3 .data/digest.db "SELECT title, final_score FROM items ORDER BY final_score DESC LIMIT 5;"
```

## Workflow

### Starting a Phase
```bash
bd create "Phase X: [Description]" -t task -p 1
bd update <bead-id> --status in_progress
```

### During Development
```bash
npm run typecheck    # Check types
npm run lint        # Check lint
npx tsx scripts/test-*.ts  # Run tests
```

### Completing a Phase
```bash
# Run quality gates
npm run typecheck
npm run lint
npm run test

# Close bead
bd close <bead-id> --reason "Phase X complete with all tests passing"

# Commit
git add .
git commit -m "Phase X: [Description]"
git push
```

## Current Status (as of Dec 7, 2025)

- ✅ Phase 1: BM25 Ranking (8,058 items scored)
- ✅ Phase 2: LLM Scoring (8,058 items scored)
- ✅ Phase 3: Hybrid Ranking (2,810 items ranked weekly)
- ✅ Phase 4: Diversity Selection (33 items selected weekly, 7/7 caps enforced)
- ⏳ Phase 5: UI Components (NEXT - comprehensive planning guide ready)

## File Structure

```
code-intel-digest/
  app/
    page.tsx                     # Main dashboard (to be updated Phase 5)
    api/
      items/
        route.ts                 # GET /api/items endpoint ✅
    components/
      digest/
        item-card.tsx            # Component (Phase 5)
        items-grid.tsx           # Component (Phase 5)
        category-tabs.tsx        # Component (Phase 5)
        period-selector.tsx      # Component (Phase 5)
  src/
    lib/
      pipeline/
        bm25.ts                  # BM25 scoring ✅
        llmScore.ts              # LLM scoring ✅
        rank.ts                  # Hybrid ranking ✅
        select.ts                # Diversity selection ✅
      db/
        items.ts                 # Database operations
        index.ts                 # DB initialization
      model.ts                   # TypeScript types
      logger.ts                  # Logging
    config/
      categories.ts              # Category configuration
      feeds.ts                   # Feed mappings
  scripts/
    test-bm25.ts                 # BM25 test
    test-llm-score.ts            # LLM test
    test-ranking.ts              # Ranking test ✅
    test-api-items.ts            # API test ✅
    test-diversity.ts            # Diversity test ✅
  history/
    PHASE1_BM25_SCORING.md       # Phase 1 docs
    PHASE2_LLM_SCORING.md        # Phase 2 docs (if exists)
    PHASE3_MERGE_SCORING.md      # Phase 3 docs
    PHASE4_DIVERSITY_SELECTION.md # Phase 4 docs
  AGENTS.md                      # Project guidelines
  RANKING_STATUS.md              # Progress tracker (updated to 90%)
  SESSION_PHASE4_SUMMARY.md      # This session summary
  NEXT_SESSION_PHASE5.md         # Phase 5 planning (comprehensive!)
```

## Key Statistics

### Items in Database
- Total: 8,058
- With BM25 scores: 8,058 (100%)
- With LLM scores: 8,058 (100%)
- Within 7-day window: 3,810

### Weekly Digest
- Items loaded: 3,810
- Items ranked: 2,810 (73.76%)
- Items filtered (off-topic/low relevance): 1,000
- Final items selected: 33 (1.17% of loaded)
- Per-source diversity: 1.49 items average

### Quality Metrics
- TypeScript errors: 0
- ESLint errors: 0
- Test pass rate: 100% (7/7 categories)
- Per-source caps enforced: 7/7 categories ✅

## Configuration Reference

### Category Settings (from `src/config/categories.ts`)

| Category | maxItems | halfLifeDays | minRelevance | Weights (LLM/BM25/Recency) |
|----------|----------|--------------|--------------|---------------------------|
| newsletters | 5 | 3 | 5 | 0.45/0.35/0.20 |
| podcasts | 4 | 7 | 5 | 0.50/0.30/0.20 |
| tech_articles | 6 | 5 | 5 | 0.40/0.40/0.20 |
| ai_news | 5 | 2 | 5 | 0.45/0.35/0.20 |
| product_news | 6 | 4 | 5 | 0.45/0.35/0.20 |
| community | 4 | 3 | 4 | 0.40/0.35/0.15/0.10(engagement) |
| research | 5 | 10 | 5 | 0.50/0.30/0.20 |

### Per-Source Caps (from Phase 4)

| Period | Cap | Rationale |
|--------|-----|-----------|
| week | 2 | Most recent, prioritize diversity |
| month | 3 | More history available |
| all | 4 | Full history, allow more |

## Quick Start

### For Phase 5 (UI Implementation)
1. Read: `NEXT_SESSION_PHASE5.md` (comprehensive guide with templates)
2. Create bead: `bd create "UI Components for Digest Rendering" -t task -p 1`
3. Start work: `bd update <bead-id> --status in_progress`
4. Build components using provided templates
5. Test with: `npm run dev` (manual), `npm run typecheck`, `npm run lint`
6. Close: `bd close <bead-id> --reason "UI components implemented and tested"`

### For Maintenance
- Run tests: `npm test` or individual `npx tsx scripts/test-*.ts`
- Check status: `RANKING_STATUS.md`
- View results: `history/PHASE*.md`

## Notes

- No production server runs during development (no `npm run dev` in final submission)
- All work uses cached data from `.data/digest.db`
- OpenAI GPT-4o used when `OPENAI_API_KEY` set, heuristic fallback otherwise
- All items within 30-day window (Nov 10 - Dec 7, 2025)
- TypeScript strict mode required
- Pre-existing React hook issue in `global-error` (unrelated to ranking)

## References

- **AGENTS.md**: Global guidelines and ACE framework
- **RANKING_STATUS.md**: Real-time progress (updated after each phase)
- **history/PHASE*.md**: Complete documentation for each phase
- **NEXT_SESSION_PHASE5.md**: Detailed planning with code templates

---

**Last Updated**: December 7, 2025  
**Progress**: 90% (4 of 5 phases complete)  
**Next**: Phase 5 - UI Components
