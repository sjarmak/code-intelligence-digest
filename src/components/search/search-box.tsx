'use client';

import { useState } from 'react';
import { Category } from '@/src/lib/model';

interface SearchBoxProps {
  onSearch: (query: string, category: Category | null, period: 'week' | 'month') => void;
  isLoading: boolean;
}

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'newsletters', label: 'Newsletters' },
  { id: 'podcasts', label: 'Podcasts' },
  { id: 'tech_articles', label: 'Tech Articles' },
  { id: 'ai_news', label: 'AI News' },
  { id: 'product_news', label: 'Product News' },
  { id: 'community', label: 'Community' },
  { id: 'research', label: 'Research' },
];

export default function SearchBox({ onSearch, isLoading }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query, category, period);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Query Input */}
      <div>
        <label htmlFor="search-query" className="block text-sm font-medium mb-2">
          Search Query
        </label>
        <input
          id="search-query"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g., code search, agent context, semantic search..."
          className="w-full px-4 py-2 bg-surface border border-surface-border rounded-md text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
          disabled={isLoading}
        />
      </div>

      {/* Filters */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Category Filter */}
        <div>
          <label htmlFor="search-category" className="block text-sm font-medium mb-2">
            Category (Optional)
          </label>
          <select
            id="search-category"
            value={category || ''}
            onChange={(e) => setCategory((e.target.value as Category) || null)}
            className="w-full px-4 py-2 bg-surface border border-surface-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            disabled={isLoading}
            >
            <option value="">All Categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Period Filter */}
        <div>
          <label htmlFor="search-period" className="block text-sm font-medium mb-2">
            Time Period
          </label>
          <select
            id="search-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'week' | 'month')}
            className="w-full px-4 py-2 bg-surface border border-surface-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent"
            disabled={isLoading}
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isLoading || !query.trim()}
        className="w-full px-4 py-2 bg-black text-white rounded-md font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
