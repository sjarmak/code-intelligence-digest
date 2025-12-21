import { logger } from '../logger';

const ADS_API_BASE = 'https://api.adsabs.harvard.edu/v1/biblib';

/**
 * Retry helper with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        logger.warn(`API call failed, retrying in ${delayMs}ms`, {
          attempt: attempt + 1,
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

interface ADSLibrary {
  id: string;
  name: string;
  description?: string;
  public: boolean;
  num_documents: number;
}

interface ADSBibcode {
  bibcode: string;
  title?: string;
  authors?: string[];
  pubdate?: string;
  abstract?: string;
  body?: string; // Full text from ADS
}

interface ADSLibraryResponse {
  libraries: ADSLibrary[];
}

interface ADSLibraryItemsResponse {
  documents: string[];
  metadata: {
    name: string;
    id: string;
    description: string;
    num_documents: number;
  };
}

export async function listLibraries(
  token: string,
): Promise<ADSLibrary[]> {
  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(`${ADS_API_BASE}/libraries`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(
          `ADS API error: ${res.status} ${res.statusText} - ${error}`,
        );
      }

      return res;
    });

    const data = (await response.json()) as ADSLibraryResponse;
    logger.info('ADS libraries fetched', { count: data.libraries?.length });
    return data.libraries || [];
  } catch (error) {
    logger.error('Failed to fetch ADS libraries', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function getLibraryByName(
  name: string,
  token: string,
): Promise<ADSLibrary | null> {
  const libraries = await listLibraries(token);
  return libraries.find((lib) => lib.name === name) || null;
}

export async function getLibraryItems(
  libraryId: string,
  token: string,
  options?: { start?: number; rows?: number },
): Promise<string[]> {
  const start = options?.start || 0;
  const rows = options?.rows || 50;

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(
        `${ADS_API_BASE}/libraries/${libraryId}?start=${start}&rows=${rows}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        },
      );

      if (!res.ok) {
        const error = await res.text();
        throw new Error(
          `ADS API error: ${res.status} ${res.statusText} - ${error}`,
        );
      }

      return res;
    });

    const data = (await response.json()) as ADSLibraryItemsResponse;
    logger.info('ADS library items fetched', {
      libraryId,
      count: data.documents?.length,
    });
    return data.documents || [];
  } catch (error) {
    logger.error('Failed to fetch ADS library items', {
      libraryId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Fetch detailed metadata for bibcodes from ADS Search API
 * Uses GET request with query parameters (not POST)
 */
export async function getBibcodeMetadata(
  bibcodes: string[],
  token: string,
): Promise<Record<string, ADSBibcode>> {
  if (bibcodes.length === 0) {
    return {};
  }

  try {
    // Build query: search for all bibcodes at once
    const query = bibcodes.map((b) => `bibcode:"${b}"`).join(' OR ');
    // Include 'body' field to fetch full text content
    const fields = 'bibcode,title,author,pubdate,abstract,body';
    
    // Use GET with URL-encoded parameters
    const params = new URLSearchParams({
      q: query,
      rows: String(bibcodes.length),
      fl: fields,
    });

    const response = await retryWithBackoff(async () => {
      const res = await fetch(
        `https://api.adsabs.harvard.edu/v1/search/query?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
          },
        },
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(
          `ADS Search API error: ${res.status} ${res.statusText} - ${errorText}`,
        );
      }

      return res;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    const result: Record<string, ADSBibcode> = {};

    if (data.response?.docs) {
      for (const doc of data.response.docs) {
        result[doc.bibcode] = {
          bibcode: doc.bibcode,
          title: doc.title?.[0],
          authors: doc.author,
          pubdate: doc.pubdate,
          abstract: doc.abstract,
          body: doc.body?.[0], // Full text content
        };
      }
    }

    logger.info('ADS bibcode metadata fetched', { count: Object.keys(result).length });
    return result;
  } catch (error) {
    logger.warn('Failed to fetch ADS bibcode metadata (optional)', {
      count: bibcodes.length,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - metadata is optional
    return {};
  }
}

/**
 * Generate ADS URL for a bibcode
 */
export function getADSUrl(bibcode: string): string {
  return `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(bibcode)}`;
}

/**
 * Try to generate an arXiv URL from a bibcode if it looks like an arXiv paper
 * arXiv bibcodes typically start with year and "arXiv"
 * e.g., "2025arXiv251212730D" -> https://arxiv.org/abs/2512.12730
 */
export function getArxivUrl(bibcode: string): string | null {
  // Match pattern: YYYYarXivAAAABBBBBC
  // where YYYYAABBBBBC converts to arXiv ID AABB.BBBBC
  const match = bibcode.match(/^(\d{4})arXiv(\d{2})(\d{5})([A-Z])$/);
  if (!match) {
    return null;
  }
  const [, year, part1, part2, part3] = match;
  const arxivId = `${part1}${part2}.${part3}`;
  return `https://arxiv.org/abs/${arxivId}`;
}
