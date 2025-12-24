'use client';

import { useState } from 'react';
import { Category } from '@/src/lib/model';
import AskBox from './ask-box';
import AnswerDisplay from './answer-display';
import { DateRange } from '@/src/components/common/date-range-picker';

interface LLMAnswerResponse {
  question: string;
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string;
    relevance: number;
  }>;
  category?: string;
  period: string;
  generatedAt: string;
}

export default function QAPage() {
  const [response, setResponse] = useState<LLMAnswerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAsked, setHasAsked] = useState(false);
  const [itemsSearched, setItemsSearched] = useState(0);

  const handleAsk = async (
    question: string,
    category: Category | null,
    period: 'week' | 'month' | 'custom',
    customDateRange?: DateRange | null
  ) => {
    setIsLoading(true);
    setError(null);
    setHasAsked(true);

    try {
      const params = new URLSearchParams({
        question: question,
        period: period,
        limit: '5',
      });

      if (category) {
        params.append('category', category);
      }

      if (period === 'custom' && customDateRange) {
        params.append('startDate', customDateRange.startDate);
        params.append('endDate', customDateRange.endDate);
      }

      const response = await fetch(`/api/ask?${params.toString()}`);

      if (!response.ok) {
        // Try to get error message from response
        let errorMessage = `Failed to get answer (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;

          // Handle rate limiting specifically
          if (response.status === 429) {
            errorMessage = errorData.error || 'Rate limit exceeded. Please try again later.';
          }
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Check if response has an error field (even with 200 status)
      if (data.error) {
        throw new Error(data.error);
      }

      setResponse(data);
      setItemsSearched(0); // itemsSearched not in response, would need API update
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setResponse(null);
      // Log to console for debugging
      console.error('Ask question failed:', message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-3">
      {/* Question Form */}
      <div className="md:col-span-1">
        <div className="card p-4 sticky top-32">
          <h2 className="text-lg font-semibold mb-4">Ask a Question</h2>
          <AskBox onAsk={handleAsk} isLoading={isLoading} />
        </div>
      </div>

      {/* Answer */}
      <div className="md:col-span-2">
        {hasAsked ? (
          response ? (
            <AnswerDisplay
              question={response.question}
              answer={response.answer}
              sources={response.sources}
              isLoading={isLoading}
              error={error}
              generatedAt={response.generatedAt}
              itemsSearched={itemsSearched}
            />
          ) : (
            <AnswerDisplay
              question=""
              answer=""
              sources={[]}
              isLoading={isLoading}
              error={error}
            />
          )
        ) : (
          <div className="text-center py-12">
            <p className="text-muted">Ask a question to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
