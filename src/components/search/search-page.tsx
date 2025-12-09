'use client';

import { useState } from 'react';
import { Category } from '@/src/lib/model';
import SearchBox from './search-box';
import SearchResults from './search-results';
import { SearchResult } from '@/src/lib/pipeline/search';

export default function SearchPage() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [itemsSearched, setItemsSearched] = useState(0);

  const handleSearch = async (query: string, category: Category | null, period: 'week' | 'month') => {
    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({
        q: query,
        period: period,
        limit: '20',
      });

      if (category) {
        params.append('category', category);
      }

      const response = await fetch(`/api/search?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Search failed (${response.status})`);
      }

      setResults(data.results || []);
      setItemsSearched(data.itemsSearched || 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-3">
      {/* Search Form */}
      <div className="md:col-span-1">
        <div className="card p-4 sticky top-32">
          <h2 className="text-lg font-semibold mb-4">Search</h2>
          <SearchBox onSearch={handleSearch} isLoading={isLoading} />
        </div>
      </div>

      {/* Results */}
      <div className="md:col-span-2">
        {hasSearched ? (
          <SearchResults results={results} isLoading={isLoading} error={error} itemsSearched={itemsSearched} />
        ) : (
          <div className="text-center py-12">
            <p className="text-muted">Enter a search query to get started</p>
          </div>
        )}
      </div>
    </div>
  );
}
