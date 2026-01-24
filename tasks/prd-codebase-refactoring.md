# PRD: Codebase Refactoring for Optimization and Consistency

## Introduction

Comprehensive refactoring of the Code Intelligence Digest codebase to eliminate code duplication, ensure consistency across sync and scoring implementations, optimize performance, and establish comprehensive test coverage. This addresses technical debt accumulated during rapid development while preserving all existing functionality.

## Goals

- **Performance:** Reduce redundant computation (BM25 recalculation, unnecessary index rebuilding)
- **Maintainability:** Eliminate duplicated code (~500+ lines) across scoring and sync modules
- **Consistency:** Unify database access patterns, date filtering logic, and scoring formulas
- **Reliability:** Add comprehensive test coverage to prevent regressions
- **Clarity:** Establish single sources of truth for configuration and constants

## User Stories

### Phase 1: Critical Fixes (Bug Prevention)

#### US-001: Unify Recency Score Formula
**Description:** As a developer, I need a single recency score formula so that items are scored consistently regardless of code path.

**Acceptance Criteria:**
- [ ] Create `src/lib/pipeline/scoring-utils.ts` with `computeRecencyScore(publishedAt: Date, halfLifeDays: number): number`
- [ ] Formula: `0.2 + 0.8 * Math.pow(2, -ageDays / halfLifeDays)` (combining both existing approaches)
- [ ] Update `compute-scores.ts` to import and use the shared function
- [ ] Update `rank.ts` to import and use the shared function
- [ ] Remove duplicate implementations from both files
- [ ] Add unit tests verifying score decay: 1.0 at age=0, ~0.6 at half-life, 0.2 floor
- [ ] Typecheck passes
- [ ] Existing API responses produce same scores (within 0.01 tolerance)

#### US-002: Fix Weekly Sync Database Driver
**Description:** As a developer, I need weekly-sync to use the database driver abstraction so it works with PostgreSQL in production.

**Acceptance Criteria:**
- [ ] Update `weekly-sync.ts` to import `getDbClient` and `detectDriver` from `driver.ts`
- [ ] Replace all `getSqlite()` calls with `await getDbClient()`
- [ ] Update SQL syntax to use driver-compatible placeholders
- [ ] Remove direct `better-sqlite3` imports
- [ ] Add integration test running weekly-sync against test PostgreSQL database
- [ ] Typecheck passes
- [ ] Weekly sync endpoint returns success with PostgreSQL

---

### Phase 2: Consolidate Duplicated Constants

#### US-003: Extract Shared Category Constants
**Description:** As a developer, I need a single definition of valid categories so changes propagate everywhere.

**Acceptance Criteria:**
- [ ] Add `VALID_CATEGORIES` export to `src/lib/model.ts`
- [ ] Update `daily-sync.ts` to import from model.ts
- [ ] Update `weekly-sync.ts` to import from model.ts
- [ ] Update `inoreader-sync.ts` to import from model.ts
- [ ] Update `app/api/items/route.ts` to import from model.ts
- [ ] Search codebase for other `Category[]` definitions and consolidate
- [ ] Add unit test verifying VALID_CATEGORIES matches Category type
- [ ] Typecheck passes

#### US-004: Extract Filter Patterns to Shared Config
**Description:** As a developer, I need filter patterns defined once so updates apply consistently.

**Acceptance Criteria:**
- [ ] Create `src/config/filter-patterns.ts`
- [ ] Move `BAD_TITLE_PATTERNS` (55 patterns) to shared config
- [ ] Move `BAD_URL_PATTERNS` (11 patterns) to shared config
- [ ] Export `filterLowQualityItem(item: FeedItem): { filtered: boolean; reason?: string }`
- [ ] Update `rank.ts` `rankCategory` to use shared filter function
- [ ] Update `rank.ts` `rankCategoryWithoutRecency` to use shared filter function
- [ ] Add unit tests for filter function with edge cases
- [ ] Typecheck passes

#### US-005: Extract Boost Logic to Shared Module
**Description:** As a developer, I need boost multiplier logic defined once so scoring is consistent.

**Acceptance Criteria:**
- [ ] Add to `src/lib/pipeline/scoring-utils.ts`:
  - `PRODUCT_NAMES: string[]` (11 products)
  - `CORE_TERMS: string[]` (13 terms)
  - `computeBoostMultiplier(content: string, category: Category): { multiplier: number; tags: string[] }`
- [ ] Update `compute-scores.ts` to use shared boost function
- [ ] Update `rank.ts` to use shared boost function
- [ ] Remove duplicate arrays and logic from both files
- [ ] Add unit tests: Sourcegraph=5x, 3 core terms=3x, product match=3-4x
- [ ] Typecheck passes
- [ ] Verify API responses have same boost multipliers applied

---

### Phase 3: Consolidate Sync Infrastructure

#### US-006: Extract Sync State Management
**Description:** As a developer, I need shared sync state functions so all sync implementations handle state consistently.

**Acceptance Criteria:**
- [ ] Create `src/lib/sync/sync-state.ts`
- [ ] Define `SyncState` interface with all fields
- [ ] Implement `loadSyncState(syncId: string): Promise<SyncState | null>`
- [ ] Implement `saveSyncState(syncId: string, state: Partial<SyncState>): Promise<void>`
- [ ] Implement `clearSyncState(syncId: string): Promise<void>`
- [ ] Use database driver abstraction (works with SQLite and PostgreSQL)
- [ ] Update `daily-sync.ts` to use shared state functions
- [ ] Update `weekly-sync.ts` to use shared state functions
- [ ] Add unit tests for state persistence and retrieval
- [ ] Typecheck passes

#### US-007: Create Unified Sync Core
**Description:** As a developer, I need a single sync implementation to reduce maintenance burden and ensure consistent behavior.

**Acceptance Criteria:**
- [ ] Create `src/lib/sync/sync-core.ts` with `runSync(options: SyncOptions): Promise<SyncResult>`
- [ ] `SyncOptions`: `{ lookbackDays?: number, force?: boolean, pageSize?: number, syncId?: string }`
- [ ] Extract common logic: user ID fetching, pagination, normalization, categorization, scoring
- [ ] Support both "fetch since newest item" and "fixed lookback" modes
- [ ] Update `daily-sync.ts` to be thin wrapper calling `runSync({ lookbackDays: undefined })`
- [ ] Update `weekly-sync.ts` to be thin wrapper calling `runSync({ lookbackDays: 7 })`
- [ ] Add integration tests for both sync modes
- [ ] Typecheck passes
- [ ] Both sync endpoints return same structure and behavior

#### US-008: Evaluate and Handle Legacy Sync Code
**Description:** As a developer, I need to decide what to do with deprecated sync implementations.

**Acceptance Criteria:**
- [ ] Review `inoreader-sync.ts` usage - check if any routes still call it
- [ ] Review `inoreader-sync-optimized.ts` usage
- [ ] If unused: delete files and remove imports
- [ ] If used: update to use sync-core or add clear deprecation path
- [ ] Update any API routes that reference deprecated sync functions
- [ ] Document decision in code comments
- [ ] Typecheck passes
- [ ] No runtime errors from removed code

---

### Phase 4: Optimize Scoring Pipeline

#### US-009: Skip Redundant BM25 Computation
**Description:** As a developer, I want to skip BM25 index building for items that already have scores to improve API response time.

**Acceptance Criteria:**
- [ ] In `rank.ts`, only build BM25 index for items without pre-computed scores
- [ ] Add early return if all items have pre-computed BM25 scores
- [ ] Log performance improvement: "Skipped BM25 for N items with cached scores"
- [ ] Add benchmark test comparing response time with/without optimization
- [ ] Typecheck passes
- [ ] API responses unchanged (same scores returned)

#### US-010: Consolidate Domain Term Configuration
**Description:** As a developer, I need domain terms defined in one place so BM25 and boost logic use the same weights.

**Acceptance Criteria:**
- [ ] Create `src/config/domain-terms.ts` as single source of truth
- [ ] Migrate `DOMAIN_TERMS` from `bm25.ts`
- [ ] Migrate `DOMAIN_TERM_WEIGHTS` from `categories.ts`
- [ ] Unify structure: `{ term: string, weight: number, category: string }[]`
- [ ] Update `bm25.ts` to import from domain-terms.ts
- [ ] Update `categories.ts` to import from domain-terms.ts
- [ ] Remove duplicate definitions
- [ ] Add unit test verifying no duplicate terms with different weights
- [ ] Typecheck passes

---

### Phase 5: Refactor Ranking Module

#### US-011: Merge rankCategory and rankCategoryWithoutRecency
**Description:** As a developer, I want a single ranking function with options to reduce code duplication (~350 lines).

**Acceptance Criteria:**
- [ ] Add `includeRecency?: boolean` option to `rankCategory` function signature
- [ ] Default `includeRecency` to `true` for backwards compatibility
- [ ] Move recency logic inside conditional based on option
- [ ] Update all callers of `rankCategoryWithoutRecency` to use `rankCategory(..., { includeRecency: false })`
- [ ] Delete `rankCategoryWithoutRecency` function
- [ ] Add unit tests for both recency modes
- [ ] Typecheck passes
- [ ] Existing API behavior unchanged

---

### Phase 6: Extract API Query Logic

#### US-012: Create Items Query Builder
**Description:** As a developer, I need database queries extracted from the API route for testability and reuse.

**Acceptance Criteria:**
- [ ] Create `src/lib/db/queries/items-query.ts`
- [ ] Implement `buildItemsQuery(category, period, options): { sql: string, params: unknown[] }`
- [ ] Handle all category-specific logic (research, newsletters, etc.)
- [ ] Handle all period-specific logic (day, week, month, all, custom)
- [ ] Update `app/api/items/route.ts` to use query builder
- [ ] Reduce route.ts by ~150 lines of inline SQL construction
- [ ] Add unit tests for query builder with various category/period combinations
- [ ] Typecheck passes
- [ ] API responses unchanged

#### US-013: Centralize Date Filtering Logic
**Description:** As a developer, I need consistent date filtering rules so items appear in expected time periods.

**Acceptance Criteria:**
- [ ] Create `getDateFilterConfig(category, period): DateFilterConfig` in query builder
- [ ] `DateFilterConfig`: `{ column: 'published_at' | 'created_at', skipFilter: boolean, cutoffTimestamp: number }`
- [ ] Document each category's filtering rules in comments
- [ ] Use in items-query.ts query builder
- [ ] Use in rank.ts date filtering
- [ ] Add unit tests verifying filter config for each category/period combination
- [ ] Typecheck passes

---

### Phase 7: Comprehensive Testing

#### US-014: Add Scoring Pipeline Unit Tests
**Description:** As a developer, I need unit tests for scoring utilities to catch regressions.

**Acceptance Criteria:**
- [ ] Create `src/lib/pipeline/__tests__/scoring-utils.test.ts`
- [ ] Test `computeRecencyScore` with various ages and half-lives
- [ ] Test `computeBoostMultiplier` with product names, core terms, combinations
- [ ] Test edge cases: empty content, no matches, max boost scenarios
- [ ] Achieve 100% line coverage for scoring-utils.ts
- [ ] Tests pass in CI

#### US-015: Add Sync Integration Tests
**Description:** As a developer, I need integration tests for sync to ensure database operations work correctly.

**Acceptance Criteria:**
- [ ] Create `src/lib/sync/__tests__/sync-core.test.ts`
- [ ] Test sync state persistence and retrieval
- [ ] Test sync with mocked Inoreader API responses
- [ ] Test rate limit handling (429 response)
- [ ] Test continuation token pagination
- [ ] Test both PostgreSQL and SQLite drivers
- [ ] Tests pass in CI

#### US-016: Add Filter Pattern Tests
**Description:** As a developer, I need tests for content filters to prevent false positives/negatives.

**Acceptance Criteria:**
- [ ] Create `src/config/__tests__/filter-patterns.test.ts`
- [ ] Test each BAD_TITLE_PATTERN with positive and negative examples
- [ ] Test each BAD_URL_PATTERN with positive and negative examples
- [ ] Test `filterLowQualityItem` function with real-world examples
- [ ] Document any patterns that may need adjustment
- [ ] Tests pass in CI

#### US-017: Add API Route Integration Tests
**Description:** As a developer, I need integration tests for the items API to catch query regressions.

**Acceptance Criteria:**
- [ ] Create `app/api/items/__tests__/route.test.ts`
- [ ] Test each category with each period (7 categories × 4 periods = 28 combinations)
- [ ] Test custom date range queries
- [ ] Test pagination with excludeIds parameter
- [ ] Test error handling for invalid parameters
- [ ] Use test database with seeded data
- [ ] Tests pass in CI

---

## Functional Requirements

### Scoring
- FR-1: Single `computeRecencyScore` function used by all scoring code paths
- FR-2: Single `computeBoostMultiplier` function with consistent product/term lists
- FR-3: BM25 computation skipped for items with cached scores
- FR-4: Domain terms defined once and imported by BM25 and boost logic

### Sync
- FR-5: All sync implementations use database driver abstraction (PostgreSQL + SQLite)
- FR-6: Sync state management shared across all sync variants
- FR-7: Single core sync function with configurable lookback period
- FR-8: Legacy sync code removed or clearly deprecated

### API
- FR-9: Query construction extracted to testable builder functions
- FR-10: Date filtering rules centralized and documented
- FR-11: Single `rankCategory` function with recency as optional parameter

### Configuration
- FR-12: `VALID_CATEGORIES` defined once in model.ts
- FR-13: Filter patterns defined once in filter-patterns.ts
- FR-14: Domain terms defined once in domain-terms.ts

### Testing
- FR-15: Unit tests for all extracted utilities (>90% coverage)
- FR-16: Integration tests for sync operations
- FR-17: Integration tests for API routes

---

## Non-Goals

- **No new features:** This is pure refactoring + optimization
- **No schema changes:** Database structure remains unchanged
- **No API changes:** All endpoints return same response structure
- **No UI changes:** Frontend code not touched
- **No algorithm changes:** Scoring formulas produce same results (within tolerance)

---

## Technical Considerations

### Dependencies
- Existing test framework (Jest/Vitest) - verify which is configured
- Database test fixtures needed for integration tests
- Mock Inoreader API responses for sync tests

### Migration Strategy
- Each phase can be merged independently
- Feature flags not needed (internal refactoring)
- Rollback: git revert if issues detected

### Performance Targets
- API response time: no regression (ideally 10-20% improvement from BM25 skip)
- Sync duration: no regression
- Memory usage: no regression

### Risk Mitigation
- Run full test suite after each phase
- Compare API responses before/after using snapshot testing
- Monitor production logs after deployment

---

## Success Metrics

- [ ] Zero duplicate function definitions for scoring logic
- [ ] Single source of truth for all configuration arrays
- [ ] All sync implementations work with PostgreSQL
- [ ] Test coverage > 80% for refactored modules
- [ ] API response times equal or better than baseline
- [ ] No regressions in production (monitored for 1 week post-deploy)

---

## Open Questions

1. **Test framework:** Is Jest or Vitest configured? Need to verify before writing tests.
2. **CI pipeline:** Are there existing CI workflows to add tests to?
3. **Snapshot testing:** Should we add API response snapshots for regression detection?
4. **Performance baseline:** Do we have current API response time metrics to compare against?
5. **Deployment strategy:** Deploy all phases at once or incrementally?

---

## Implementation Order

Recommended sequence to minimize risk:

1. **Phase 1** (Critical Fixes) - Unblock PostgreSQL, fix scoring inconsistency
2. **Phase 2** (Constants) - Low risk, high maintainability win
3. **Phase 7** (Testing) - Add tests before major refactoring
4. **Phase 5** (Ranking) - Single function reduces surface area
5. **Phase 3** (Sync) - Higher risk, do after tests in place
6. **Phase 4** (Optimization) - Performance wins
7. **Phase 6** (API Queries) - Cleanup, lower priority
