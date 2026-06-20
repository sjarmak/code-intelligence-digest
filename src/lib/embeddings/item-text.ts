/**
 * Canonical document text for embedding an item.
 *
 * Single source of truth for the doc-side input so source_hash stays stable
 * across the backfill and any later re-embed run (a changing formula would
 * silently invalidate every hash and re-embed the whole corpus). Deliberately
 * excludes sourceTitle, matching the bulk-backfill formula (not the serve-side
 * search.ts variant). Encoder task-prefixes (search_document:/search_query:)
 * are applied by the caller, not here.
 */
import type { FeedItem } from "../model";

const FULL_TEXT_MAX_CHARS = 2000;
// Hard cap on the whole input. full_text is already bounded above, but title/
// summary/contentSnippet are not — a pathological ~50K-char summary (the
// dv0.5.8 stall) becomes a ~13K-token sequence that OOMs the encoder's O(n^2)
// attention when batched. 8000 chars (~2000 tokens, matching the OpenAI lane)
// keeps every input well under nomic's 8192-token limit.
const TOTAL_MAX_CHARS = 8000;

export function buildItemText(item: FeedItem): string {
  const fullText = item.fullText ? item.fullText.substring(0, FULL_TEXT_MAX_CHARS) : "";
  return `${item.title} ${item.summary ?? ""} ${item.contentSnippet ?? ""} ${fullText}`
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, TOTAL_MAX_CHARS);
}
