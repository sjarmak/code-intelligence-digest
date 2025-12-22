'use client';

interface DigestSummaryProps {
  summary: string;
  dateRange: { start: string; end: string };
  itemCount: number;
  generatedAt: string;
}

export default function DigestSummary({
  summary,
  dateRange,
  itemCount,
  generatedAt,
}: DigestSummaryProps) {
  return (
    <div className="bg-surface border border-surface-border rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Weekly Summary</h2>
          <p className="text-sm text-muted mt-1">
            {dateRange.start} to {dateRange.end}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-black">{itemCount}</div>
          <p className="text-sm text-muted">items</p>
        </div>
      </div>

      <p className="text-foreground leading-relaxed whitespace-pre-wrap">
        {summary}
      </p>

      <p className="text-xs text-muted mt-4">
        Generated {new Date(generatedAt).toLocaleDateString()}
      </p>
    </div>
  );
}
