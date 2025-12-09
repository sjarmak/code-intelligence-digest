# Phase 6: Complete Documentation Index

**Planning Completed**: December 7, 2025  
**Status**: ✅ Ready for Implementation  
**Project Progress**: 83% (5 of 6 major phases complete)

---

## Quick Links

### Start Here
- **QUICK_REFERENCE.md** - Fast lookup, bead cheatsheet, command reference
- **PHASE6_SUMMARY.md** - Executive summary, timeline, risks

### Complete Details
- **PHASE6_PLAN.md** - Feature breakdown, architecture decisions
- **PHASE6_ARCHITECTURE.md** - Technical design, data flows, schemas
- **PHASE6_BEADS.md** - Task registry, dependencies, acceptance criteria

### Investigation & Analysis
- **SEARCH_QUALITY_ANALYSIS.md** - Root cause analysis of search ranking issue
- **SESSION_PHASE6_PLANNING.md** - Session notes, key decisions, next steps

---

## File Overview

### PHASE6_PLAN.md (6 pages)
**Purpose**: Feature overview and requirements

**Sections**:
1. New Requirements (5 features)
2. Implementation Order (6 phases)
3. File Structure Changes
4. Quality Gates
5. Risks & Mitigation
6. Next Steps

**Use When**: Understanding what needs to be built and why

---

### PHASE6_ARCHITECTURE.md (12 pages)
**Purpose**: Technical design and implementation details

**Sections**:
1. System Architecture (with diagrams)
2. Component Breakdown (6 major components)
3. Data Flow Examples (3 detailed examples)
4. Database Schema Changes
5. Cost Analysis
6. Performance Targets
7. Security & Privacy
8. Migration Strategy

**Use When**: Implementing features, designing data structures, understanding costs

---

### PHASE6_BEADS.md (10 pages)
**Purpose**: Task registry and implementation guide

**Sections**:
1. Bead Registry (6 beads with full specs)
2. Dependencies & Critical Path
3. Recommended Execution Order
4. Testing Strategy
5. Success Metrics

**Use When**: Starting a bead, understanding dependencies, planning sprints

---

### SEARCH_QUALITY_ANALYSIS.md (8 pages)
**Purpose**: Root cause analysis of search ranking issue

**Sections**:
1. Problem Statement
2. Technical Investigation Areas
3. Recommended Fix Strategy (4 phases)
4. Testing Plan
5. Implementation Checklist
6. Success Criteria

**Use When**: Working on code-intel-digest-71d (search fix)

---

### PHASE6_SUMMARY.md (6 pages)
**Purpose**: High-level overview and project status

**Sections**:
1. Overview
2. New Requirements & Beads
3. Implementation Plan
4. Quality Gates
5. Risk Assessment
6. Success Criteria

**Use When**: Need executive summary, sharing with team, planning resources

---

### SESSION_PHASE6_PLANNING.md (8 pages)
**Purpose**: Session notes and decisions made

**Sections**:
1. What Was Accomplished
2. Key Decisions Made
3. Technical Implementation Plan
4. Quality Assurance Plan
5. Risk Assessment
6. Cost Impact
7. Remaining Work (Phase 7+)

**Use When**: Understanding why decisions were made, context for implementation

---

### QUICK_REFERENCE.md (5 pages)
**Purpose**: Quick lookup and cheat sheet

**Sections**:
1. Beads at a Glance
2. Features Overview
3. Implementation Roadmap (3-day plan)
4. Key Files (by task)
5. Commands to Know
6. Common Pitfalls & Fixes
7. Testing Checklist
8. Cost Summary
9. Documentation Map

**Use When**: Quick lookup during implementation, need commands, checking progress

---

### PHASE6_INDEX.md (this file)
**Purpose**: Navigation guide for all Phase 6 documentation

**Use When**: First time reading Phase 6 docs, need to find specific information

---

## Navigation by Task

### Working on Search Ranking (code-intel-digest-71d)
1. Read: SEARCH_QUALITY_ANALYSIS.md (root cause)
2. Read: PHASE6_ARCHITECTURE.md → "2. Search Pipeline" (technical)
3. Ref: QUICK_REFERENCE.md → "Search Fix (71d)" (quick lookup)

### Working on Embeddings (code-intel-digest-lv2)
1. Read: PHASE6_ARCHITECTURE.md → "3. Embeddings System" (design)
2. Read: PHASE6_BEADS.md → "Bead: code-intel-digest-lv2" (specs)
3. Ref: QUICK_REFERENCE.md → "Embeddings (lv2)" (overview)

### Working on QA System (code-intel-digest-hj4)
1. Read: PHASE6_ARCHITECTURE.md → "5. Answer Generation" (design)
2. Read: PHASE6_BEADS.md → "Bead: code-intel-digest-hj4" (specs)
3. See: PHASE6_ARCHITECTURE.md → "Data Flow Example 2" (flow)

### Working on List Format (code-intel-digest-7jb)
1. Read: PHASE6_PLAN.md → "Update UI Format" (requirements)
2. Read: PHASE6_BEADS.md → "Bead: code-intel-digest-7jb" (specs)
3. Ref: QUICK_REFERENCE.md → "List Format (7jb)" (overview)

### Working on Daily Period (code-intel-digest-hv1)
1. Read: PHASE6_PLAN.md → "Daily Period" (requirements)
2. Read: PHASE6_BEADS.md → "Bead: code-intel-digest-hv1" (specs)
3. See: QUICK_REFERENCE.md → "Daily Period (hv1)" (overview)

### Working on Digest Page (code-intel-digest-byv)
1. Read: PHASE6_PLAN.md → "Digest Page" (requirements)
2. Read: PHASE6_ARCHITECTURE.md → "6. Digest Page" (design)
3. See: PHASE6_ARCHITECTURE.md → "Data Flow Example 3" (flow)

---

## Key Concepts to Understand

### Hybrid Scoring for Search
- **Current**: finalScore * 0.8 + semanticScore * 0.2
- **Proposed**: finalScore * 0.5 + semanticScore * 0.5 (for search mode)
- **Why**: Semantic exact matches should rank higher
- **See**: SEARCH_QUALITY_ANALYSIS.md → "3. Hybrid Score Blending"

### Embeddings Infrastructure
- **What**: 768-dimension vectors from OpenAI API
- **When**: Generated during daily sync (1x per day)
- **Where**: Stored in SQLite BLOB field
- **Cost**: $1.50/year
- **See**: PHASE6_ARCHITECTURE.md → "3. Embeddings System"

### QA Retrieval Pipeline
- **Flow**: Retrieve top-5 → Rank with BM25+LLM → Pass to LLM
- **Key**: Balance retrieval quality with generation speed
- **Cost**: $0.003 per answer (Claude Haiku)
- **See**: PHASE6_ARCHITECTURE.md → "5. Answer Generation"

### Diversity Constraints by Period
- **Daily**: 1 item per source (stricter)
- **Week**: 2 items per source
- **Month**: 3 items per source
- **All-time**: 4 items per source
- **See**: PHASE6_PLAN.md → "Daily Time Period"

---

## Implementation Sequence

### Phase 6A (This Week) - 6 hours
```
Morning:  Start 71d (search fix) + Complete hv1 (daily)
Afternoon: Start 7jb (list UI) + Start lv2 (embeddings)
```
**Read First**: SEARCH_QUALITY_ANALYSIS.md + QUICK_REFERENCE.md

### Phase 6B (Next) - 6 hours
```
Morning: Finish 7jb (list UI) + Finish lv2 (embeddings)
Afternoon: Work on hj4 (QA system)
```
**Read First**: PHASE6_ARCHITECTURE.md → Components 3, 5

### Phase 6C (Parallel) - 6 hours
```
Complete: hj4 (QA) + Start byv (digest page)
```
**Read First**: PHASE6_BEADS.md → Dependencies section

### Phase 6D (Final) - 6 hours
```
Complete: byv (digest page) + Final testing
```
**Read First**: QUICK_REFERENCE.md → Testing Checklist

---

## Beads Quick Reference

| Bead ID | Title | Priority | Time | Read |
|---------|-------|----------|------|------|
| 71d | Search ranking fix | P1 | 4-6h | SEARCH_QUALITY_ANALYSIS.md |
| hv1 | Daily period | P3 | 2-3h | PHASE6_PLAN.md |
| 7jb | List format UI | P2 | 3-4h | PHASE6_PLAN.md |
| lv2 | Embeddings | P1 | 6-8h | PHASE6_ARCHITECTURE.md |
| hj4 | QA answers | P1 | 5-7h | PHASE6_ARCHITECTURE.md |
| byv | Digest page | P2 | 4-5h | PHASE6_ARCHITECTURE.md |

**Total**: 24-27 hours (estimated 18-24 with parallelization)

---

## Quality Gates Checklist

Before each commit:
- [ ] `npm run typecheck` - 0 TypeScript errors
- [ ] `npm run lint` - 0 ESLint errors
- [ ] `npm test -- --run` - All tests passing
- [ ] No regressions in Phase 1-5 features

Before Phase 6 completion:
- [ ] Search quality test passes ('code search' → correct ranking)
- [ ] Daily period works in all 3 tabs
- [ ] List format responsive on mobile
- [ ] Embeddings generating and caching
- [ ] QA answers coherent and sourced
- [ ] Digest page displaying correctly
- [ ] 50+ new tests added
- [ ] Cost verified <$50/month

---

## Commands Reference

### Build & Test
```bash
npm run build          # Check build
npm run typecheck      # Type check
npm run lint           # Lint check
npm test -- --run      # Tests (once)
npm test               # Tests (watch)
```

### Database
```bash
sqlite3 .data/digest.db ".schema"        # View schema
sqlite3 .data/digest.db ".tables"        # List tables
sqlite3 .data/digest.db "SELECT COUNT(*) FROM items;"
```

### Beads
```bash
bd list --json                           # List all
bd create "Title" -t feature -p 1 --json # New bead
bd update <id> --status in_progress      # Start work
bd close <id> --reason "Done"            # Finish
```

---

## Documentation Stats

| Document | Pages | Words | Focus |
|----------|-------|-------|-------|
| PHASE6_PLAN.md | 6 | 3,200 | Requirements |
| PHASE6_ARCHITECTURE.md | 12 | 6,800 | Technical |
| PHASE6_BEADS.md | 10 | 5,400 | Tasks |
| SEARCH_QUALITY_ANALYSIS.md | 8 | 4,100 | Investigation |
| PHASE6_SUMMARY.md | 6 | 3,500 | Executive |
| SESSION_PHASE6_PLANNING.md | 8 | 4,200 | Session notes |
| QUICK_REFERENCE.md | 5 | 2,800 | Cheatsheet |
| **TOTAL** | **55** | **30,000** | Complete |

**Effort**: 2 hours planning → 55 pages of documentation

---

## Next Session (Phase 6A)

**Title**: Search Fix & Daily Period Implementation  
**Time**: 6-8 hours  
**Beads**: code-intel-digest-71d + code-intel-digest-hv1  
**Success**: 'code search' ranks correctly + daily period works

**Preparation**:
1. Read SEARCH_QUALITY_ANALYSIS.md (root cause)
2. Review QUICK_REFERENCE.md (quick lookup)
3. Verify all beads created: `bd list | grep -E "(71d|hv1)"`
4. Ready to start: Pick one bead, update status to "in_progress"

---

**Created**: December 7, 2025 19:45 UTC  
**Status**: ✅ Complete  
**Usage**: Bookmark this file for easy navigation

---

## How to Use This Index

### For Quick Answers
→ Check QUICK_REFERENCE.md (fastest)

### For Understanding Why
→ Check SESSION_PHASE6_PLANNING.md (decisions)

### For Technical Details
→ Check PHASE6_ARCHITECTURE.md (design)

### For Task Specs
→ Check PHASE6_BEADS.md (requirements)

### For Investigation Steps
→ Check SEARCH_QUALITY_ANALYSIS.md (root cause)

### For Everything
→ Read in order: PHASE6_SUMMARY.md → PHASE6_PLAN.md → PHASE6_ARCHITECTURE.md

---

**End of Index**
