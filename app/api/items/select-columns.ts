/**
 * Column projection for the `GET /api/items` list view.
 *
 * `full_text` is a 50–200 KB blob per row. The list endpoint can load up to
 * 1000 rows (period=all), and `full_text` is never returned to the client — it
 * is only read to feed the BM25 body-term boost in `rankCategory`, which already
 * truncates it to 8000 chars. Loading the full blobs for every row was the
 * dominant per-request allocation spike behind the silent cgroup OOM-kills on
 * the 512 MB Render container (bd code-intel-digest-n0m; oom_investigation_2026_04
 * §5, suspect #1).
 *
 * Non-research categories therefore project an explicit column list that omits
 * `full_text` (replacing the previous `SELECT *`). The `research` category keeps
 * it — plus its fetch metadata — because the research view relies on its
 * presence to flag which papers have full text available.
 */
const ITEMS_LIST_BASE_COLUMNS = [
  "id",
  "stream_id",
  "source_title",
  "title",
  "url",
  "author",
  "published_at",
  "summary",
  "content_snippet",
  "categories",
  "category",
  "created_at",
  "updated_at",
  "extracted_url",
] as const;

const RESEARCH_FULLTEXT_COLUMNS = [
  "full_text",
  "full_text_fetched_at",
  "full_text_source",
] as const;

/**
 * Returns the comma-separated SQL column list for the items list query.
 * Research keeps `full_text` (+ metadata); every other category omits it.
 */
export function itemsListSelectColumns(category: string): string {
  const columns =
    category === "research"
      ? [...ITEMS_LIST_BASE_COLUMNS, ...RESEARCH_FULLTEXT_COLUMNS]
      : ITEMS_LIST_BASE_COLUMNS;
  return columns.join(", ");
}
