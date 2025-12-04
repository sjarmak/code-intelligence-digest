'use client';

interface SourceReference {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  relevance: number;
}

interface AnswerDisplayProps {
  question: string;
  answer: string;
  sources: SourceReference[];
  isLoading: boolean;
  error: string | null;
  generatedAt?: string;
  itemsSearched?: number;
}

function getSimilarityColor(score: number): string {
  if (score >= 0.8) return 'text-green-400';
  if (score >= 0.6) return 'text-yellow-400';
  if (score >= 0.4) return 'text-orange-400';
  return 'text-red-400';
}

export default function AnswerDisplay({
  question,
  answer,
  sources,
  isLoading,
  error,
  generatedAt,
  itemsSearched,
}: AnswerDisplayProps) {
  if (isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">Analyzing digest and finding answer...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900 bg-red-900/20 p-4">
        <p className="text-red-400 font-medium">Error</p>
        <p className="text-red-300 text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Question */}
      <div className="card p-4">
        <p className="text-xs text-muted uppercase tracking-wide mb-2">Your Question</p>
        <p className="text-lg font-semibold text-foreground">{question}</p>
      </div>

      {/* Answer */}
      <div className="card p-4">
        <p className="text-xs text-muted uppercase tracking-wide mb-3">Answer</p>
        <div className="prose prose-invert max-w-none">
          <p className="text-foreground whitespace-pre-wrap leading-relaxed">{answer}</p>
        </div>

        {generatedAt && (
          <p className="text-xs text-muted mt-4 pt-4 border-t border-surface-border">
            Generated {new Date(generatedAt).toLocaleString()}
            {itemsSearched ? ` from ${itemsSearched} items` : ''}
          </p>
        )}
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div className="card p-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-3">
            Source Citations ({sources.length})
          </p>
          <div className="space-y-3">
            {sources.map((source, idx) => (
              <div key={source.id} className="border-l-2 border-blue-600/30 pl-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors flex-1"
                  >
                    {idx + 1}. {source.title}
                  </a>
                  <span className={`text-xs font-semibold whitespace-nowrap ${getSimilarityColor(source.relevance)}`}>
                    {(source.relevance * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-xs text-muted">{source.sourceTitle}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {sources.length === 0 && (
        <div className="rounded-lg border border-amber-900 bg-amber-900/20 p-4">
          <p className="text-amber-400 text-sm">
            No source citations available. Try a different question or adjust your filters.
          </p>
        </div>
      )}
    </div>
  );
}
