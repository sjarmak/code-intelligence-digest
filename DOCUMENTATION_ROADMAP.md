# Documentation Roadmap & Consolidation

## Active Documentation (Keep)

### Core System Guides (Essential)

1. **README.md** - Main project entry point
2. **AGENTS.md** - Project guidelines and command reference
3. **QUICK_START.md** - Quick setup guide

### Audio Rendering System (New - Jan 2025)

1. **AUDIO_QUICK_REFERENCE.md** - One-page audio cheat sheet
2. **AUDIO_RENDERING_GUIDE.md** - Complete audio technical guide
3. **AUDIO_RENDERING_EXAMPLES.md** - Audio usage examples
4. **API_REFERENCE.md** - Full API reference (audio + existing)
5. **AUDIO_IMPLEMENTATION_COMPLETE.md** - Audio architecture details
6. **TEST_EXECUTION_REPORT.md** - Test results
7. **TEST_ARTIFACTS.md** - Test data and verification

### ADS Integration Guides

1. **ADS_LIBRARIES_GUIDE.md** - ADS libraries feature guide
2. **QUICK_ADS_START.md** - ADS quick start

### Admin & Sync Guides

1. **QUICK_ADMIN_REFERENCE.md** - Admin API reference
2. **DAILY_SYNC_USAGE.md** - Daily sync endpoint usage
3. **WEEKLY_SYNC_USAGE.md** - Weekly sync usage

### Search & Retrieval Guides

1. **HYBRID_SEARCH_GUIDE.md** - Hybrid search documentation
2. **QUICK_FULLTEXT_START.md** - Fulltext search quick start

---

## Stale Documentation (Archive to history/)

### Session Notes (Many duplicates)

- LANDING_SESSION.md
- LANDING_SESSION_SUMMARY.md
- LANDING_SESSION_FINAL.md
- SESSION_SUMMARY.md
- SESSION_COMPLETE.md
- SESSION_PHASE4_SUMMARY.md
- SESSION_PHASE6_PLANNING.md
- NEXT_SESSION.md
- NEXT_SESSION_BRIEF.md
- NEXT_SESSION_PHASE4.md
- NEXT_SESSION_PHASE5.md
- NEXT_WORK.md
- SEND_TO_AGENT.md

### Phase Documentation (Archived)

- PHASE5_COMPLETION.md
- PHASE5_UI_COMPLETION.md (file: PHASE5_SUMMARY.txt exists)
- PHASE6_PLAN.md
- PHASE6_SUMMARY.md
- PHASE6_SESSION_SUMMARY.md
- PHASE6_INDEX.md
- PHASE6_ARCHITECTURE.md
- PHASE6_BEADS.md
- PHASE6D_NEXT_STEPS.md

### Feature Completion Reports (Duplicates)

- COMPLETION_STATUS.md
- COMPLETION_SUMMARY.md
- CURRENT_STATUS.md
- FINAL_UPDATE.md
- FIX_SUMMARY.md
- FIXES_SESSION.md
- FULL_FEATURE_COMPLETION.md
- LANDING_CHECKLIST.md
- LANDING_REPORT.md
- LANDING_PHASE5.md
- LIVE_UPDATE.md
- READY_TO_SEND.txt

### Fulltext Search (All complete, docs are snapshot)

- FULLTEXT_AGENT_UPDATE.md
- FULLTEXT_CHECKLIST.md
- FULLTEXT_COMPLETE.md
- FULLTEXT_COVERAGE_STATUS.md
- FULLTEXT_POPULATION_GUIDE.md
- FULLTEXT_SEARCH_INTEGRATION.md
- FULLTEXT_SESSION_SUMMARY.md
- FULLTEXT_SETUP.md
- FULLTEXT_VERIFICATION_REPORT.md

### Research/ADS Integration (Complete)

- ADS_DATABASE_USAGE.md
- ADS_METADATA_INTEGRATION.md
- ADS_SETUP_COMPLETE.md
- RESEARCH_FEATURES.md
- RESEARCH_FULLTEXT_POPULATION.md
- RESEARCH_IMPLEMENTATION_COMPLETE.md
- RESEARCH_QUICK_START.md
- RESEARCH_SETUP_NOTES.md
- SESSION_ADS_SETUP.md

### Optimization & Tuning (Snapshots)

- API_BUDGET_TRACKING.md
- COST_OPTIMIZATION.md
- DAILY_SYNC_API_EFFICIENCY.md
- DAILY_SYNC_SCHEDULE.md
- RANKING_STATUS.md
- RELEVANCE_TUNING.md
- RELEVANCE_UI_IMPLEMENTATION.md
- SEARCH_QUALITY_ANALYSIS.md
- SYNC_COMPARISON.md
- SYNC_OPTIMIZATION.md

### Agent Briefs & References (Internal)

- AGENT_BRIEF_NEWSLETTER_PODCAST.md
- AGENT_BRIEF_SUMMARY.md
- AGENT_TECHNICAL_REFERENCE.md
- CLAUDE.md
- COPY_PASTE_AGENT_PROMPT.md

### Implementation Guides (Now in history/)

- IMPLEMENTATION_GUIDE.md
- IMPLEMENTATION_INDEX.md
- IMPLEMENTATION_SUMMARY.md
- NEWSLETTER_PODCAST_INDEX.md
- NEWSLETTER_PODCAST_READY.md
- OPENAI_MIGRATION.md
- OPTIMIZATION_SUMMARY.md

### UI & Synthesis (Complete)

- METADATA_CONTEXT_MAPPING.md
- QUICK_SYNTHESIS_REFERENCE.md
- QUICK_TEST.md
- SYNTHESIS_ENDPOINTS.md
- UI_SYNTHESIS_GUIDE.md
- UI_TUNING_GUIDE.md

---

## Recommended Consolidation

### 1. Create `history/` Archive

Move all stale session notes and completion reports:

```
history/
├── sessions/
│   ├── landing-session-*.md (all landing sessions)
│   ├── phase-*.md (phase docs)
│   └── next-session-*.md
├── features/
│   ├── fulltext-*.md
│   ├── research-*.md
│   ├── ads-*.md
│   └── synthesis-*.md
└── optimization/
    ├── cost-optimization.md
    ├── sync-optimization.md
    └── tuning-*.md
```

### 2. Keep in Root Only (Active Reference)

```
Root (/):
├── README.md
├── AGENTS.md
├── QUICK_START.md
├── API_REFERENCE.md
├── QUICK_ADMIN_REFERENCE.md
├── AUDIO_QUICK_REFERENCE.md
├── AUDIO_RENDERING_GUIDE.md
├── AUDIO_RENDERING_EXAMPLES.md
├── ADS_LIBRARIES_GUIDE.md
├── QUICK_ADS_START.md
├── DAILY_SYNC_USAGE.md
├── WEEKLY_SYNC_USAGE.md
├── HYBRID_SEARCH_GUIDE.md
├── QUICK_FULLTEXT_START.md
├── TEST_EXECUTION_REPORT.md
├── DOCUMENTATION_ROADMAP.md
└── .gitignore (includes history/)
```

### 3. Update README.md

Add section:
- Audio Rendering System (NEW Jan 2025)
- Links to active docs
- Archive information

### 4. Create .gitignore Entry

```gitignore
# Keep code, discard planning docs
# history/ contains legacy session notes and planning docs
history/
```

---

## File Count Summary

**Current State:**
- Total docs: 97 files
- Active: ~15 essential docs
- Stale: ~82 files (session notes, snapshots, duplicates)

**Target State:**
- Root docs: 15 active
- history/: 82 archived
- Total project size: Reduced 82 files

---

## Migration Plan

1. Create `history/` directory
2. Move 82 stale files to `history/`
3. Update `README.md` with new sections
4. Update `.gitignore`
5. Verify git status
6. Commit changes
7. Land the plane

