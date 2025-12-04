/**
 * Type definitions for Inoreader API responses
 */

export interface InoreaderStreamResponse {
  items: InoreaderArticle[];
  continuation?: string;
  id: string;
  title: string;
  updated: number;
}

export interface InoreaderArticle {
  id: string;
  title: string;
  published: number;
  updated: number;
  crawlTimeMsec: string;
  timestampUsec: string;
  canonical: { href: string }[];
  alternate: { href: string; type: string }[];
  summary: {
    content: string;
    direction: string;
  };
  author: string;
  categories: string[];
  origin: {
    streamId: string;
    title: string;
    htmlUrl: string;
  };
}

export interface InoreaderTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}
