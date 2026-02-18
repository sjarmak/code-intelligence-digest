/**
 * Format date ranges for digest, newsletter, and podcast titles.
 * Ensures labels use the actual period dates, not a fixed or hallucinated date.
 */

/**
 * Format a date as "Month Day, Year" (e.g. "February 18, 2025")
 */
export function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format a date as "Mon Day, Year" (e.g. "Feb 18, 2025")
 */
export function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface DateRangeInput {
  start: string; // ISO date YYYY-MM-DD
  end: string;   // ISO date YYYY-MM-DD
}

/**
 * Parse YYYY-MM-DD as local date (no timezone shift).
 */
function parseLocalDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Human-readable label for a period (e.g. "Feb 10–17, 2025" or "February 2025").
 * Used in digest summary, newsletter title, and podcast title.
 */
export function formatDateRangeLabel(
  range: DateRangeInput,
  period?: "day" | "week" | "month" | "all" | "custom"
): string {
  const start = parseLocalDate(range.start);
  const end = parseLocalDate(range.end);

  if (range.start === range.end) {
    return formatDateLong(end);
  }

  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

  if (period === "month" || days >= 28) {
    // Same month and year: "February 2025"
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return end.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    }
    // Span: "January – February 2025" or "Dec 2024 – Jan 2025"
    const startStr = start.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    const endStr = end.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    return `${startStr} – ${endStr}`;
  }

  // Week or custom range: "Feb 10–17, 2025"
  const startShort = formatDateShort(start);
  const endShort = formatDateShort(end);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString("en-US", { month: "short" })} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startShort} – ${endShort}`;
}

/**
 * Compute date range for the last N days (end = today).
 */
export function getDateRangeForPeriodDays(days: number): DateRangeInput {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}
