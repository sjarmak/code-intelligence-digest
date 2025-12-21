/**
 * Core data models for the Code Intelligence Digest
 */

export type Category =
  | "newsletters"
  | "podcasts"
  | "tech_articles"
  | "ai_news"
  | "product_news"
  | "community"
  | "research";

export interface FeedItem {
  id: string;
  streamId: string;
  sourceTitle: string;
  title: string;
  url: string;
  author?: string;
  publishedAt: Date;
  summary?: string;
  contentSnippet?: string;
  categories: string[];
  category: Category;
  raw: unknown;
  fullText?: string; // Optional cached full article text
}

export interface LLMScoreResult {
  id: string;
  relevance: number; // 0–10
  usefulness: number; // 0–10
  tags: string[];
}

export interface RankedItem extends FeedItem {
  bm25Score: number;
  llmScore: {
    relevance: number;
    usefulness: number;
    tags: string[];
  };
  recencyScore: number;
  engagementScore?: number;
  finalScore: number;
  reasoning: string;
}
