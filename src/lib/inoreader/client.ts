/**
 * Inoreader API client
 *
 * Simplified: No internal budget tracking - rely on Inoreader's 429 errors for rate limiting
 */

import { InoreaderStreamResponse, InoreaderTokenResponse } from "./types.js";
import { logger } from "../logger";

/**
 * Rate limit info from Inoreader API response headers
 */
export interface RateLimitInfo {
  zone1Limit: number;
  zone1Usage: number;
  zone2Limit: number;
  zone2Usage: number;
  resetAfterSeconds: number;
}

/**
 * Extract rate limit info from Inoreader API response headers
 */
function extractRateLimitInfo(response: Response): RateLimitInfo | null {
  const zone1Limit = response.headers.get('X-Reader-Zone1-Limit');
  const zone1Usage = response.headers.get('X-Reader-Zone1-Usage');
  const zone2Limit = response.headers.get('X-Reader-Zone2-Limit');
  const zone2Usage = response.headers.get('X-Reader-Zone2-Usage');
  const resetAfter = response.headers.get('X-Reader-Limits-Reset-After');

  if (!zone1Limit || !zone1Usage) {
    return null;
  }

  return {
    zone1Limit: parseInt(zone1Limit, 10),
    zone1Usage: parseInt(zone1Usage, 10),
    zone2Limit: parseInt(zone2Limit || '0', 10),
    zone2Usage: parseInt(zone2Usage || '0', 10),
    resetAfterSeconds: parseInt(resetAfter || '0', 10),
  };
}

/**
 * Log rate limit info with warning if approaching limits
 */
function logRateLimitInfo(rateLimits: RateLimitInfo | null, context: string): void {
  if (!rateLimits) return;

  const zone1Percent = (rateLimits.zone1Usage / rateLimits.zone1Limit) * 100;
  const resetMinutes = Math.round(rateLimits.resetAfterSeconds / 60);
  const resetHours = (rateLimits.resetAfterSeconds / 3600).toFixed(1);

  const logData = {
    zone1: `${rateLimits.zone1Usage}/${rateLimits.zone1Limit}`,
    zone2: `${rateLimits.zone2Usage}/${rateLimits.zone2Limit}`,
    resetIn: resetMinutes > 60 ? `${resetHours}h` : `${resetMinutes}m`,
  };

  if (zone1Percent >= 90) {
    logger.warn(`[INOREADER-RATE] ⚠️ ${context}: CRITICAL - ${zone1Percent.toFixed(0)}% of Zone1 quota used`, logData);
  } else if (zone1Percent >= 75) {
    logger.warn(`[INOREADER-RATE] ${context}: HIGH - ${zone1Percent.toFixed(0)}% of Zone1 quota used`, logData);
  } else {
    logger.info(`[INOREADER-RATE] ${context}: ${zone1Percent.toFixed(0)}% of Zone1 quota used`, logData);
  }
}

export interface FetchStreamOptions {
  n?: number;
  continuation?: string;
  xt?: string;  // Exclude tag (e.g., read items)
  ot?: number;  // Oldest timestamp - only items OLDER than this (unix epoch seconds)
  nt?: number;  // Newest timestamp - only items NEWER than this (unix epoch seconds)
}

export class InoreaderClient {
  private accessToken: string | null = null;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const clientId = process.env.INOREADER_CLIENT_ID;
    const clientSecret = process.env.INOREADER_CLIENT_SECRET;
    const refreshToken = process.env.INOREADER_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Missing Inoreader credentials. Set INOREADER_CLIENT_ID, INOREADER_CLIENT_SECRET, and INOREADER_REFRESH_TOKEN environment variables."
      );
    }

    try {
      const response = await fetch("https://www.inoreader.com/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to refresh Inoreader token: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = (await response.json()) as InoreaderTokenResponse;
      this.accessToken = data.access_token;

      return this.accessToken;
    } catch (error) {
      logger.error("Error refreshing Inoreader token", error);
      throw error;
    }
  }

  /**
   * Fetch stream contents from Inoreader
   * @param streamId The stream ID to fetch (e.g., feed/... or user/.../label/...)
   * @param options Fetch options (n=count, continuation for pagination)
   */
  async getStreamContents(
    streamId: string,
    options: FetchStreamOptions = {}
  ): Promise<InoreaderStreamResponse> {
    const token = await this.getAccessToken();
    const encodedStreamId = encodeURIComponent(streamId);

    const params = new URLSearchParams();
    if (options.n) params.append("n", options.n.toString());
    if (options.continuation) params.append("c", options.continuation);
    if (options.xt) params.append("xt", options.xt);
    if (options.ot) params.append("ot", options.ot.toString());
    if (options.nt) params.append("nt", options.nt.toString());

    const url = `https://www.inoreader.com/reader/api/0/stream/contents/${encodedStreamId}?${params.toString()}`;

    logger.info(`[INOREADER-API] getStreamContents called`, {
      streamId: streamId.substring(0, 50),
      options: { n: options.n, hasContinuation: !!options.continuation, hasNt: !!options.nt },
    });

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[INOREADER-API] getStreamContents FAILED: ${response.status}`, { streamId, errorText });
        throw new Error(
          `Failed to fetch stream contents: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Log rate limit info
      const rateLimits = extractRateLimitInfo(response);
      logRateLimitInfo(rateLimits, 'getStreamContents');

      const data = (await response.json()) as InoreaderStreamResponse;
      logger.info(`[INOREADER-API] getStreamContents SUCCESS: ${data.items?.length || 0} items`, {
        streamId: streamId.substring(0, 50),
        itemCount: data.items?.length || 0,
        hasContinuation: !!data.continuation,
      });
      return data;
    } catch (error) {
      logger.error(`Error fetching stream contents for ${streamId}`, error);
      throw error;
    }
  }

  /**
   * Fetch user info from Inoreader
   */
  async getUserInfo(): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const url = "https://www.inoreader.com/reader/api/0/user-info";

    logger.info(`[INOREADER-API] getUserInfo called`);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[INOREADER-API] getUserInfo FAILED: ${response.status}`, { errorText });
        throw new Error(
          `Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Log rate limit info
      const rateLimits = extractRateLimitInfo(response);
      logRateLimitInfo(rateLimits, 'getUserInfo');

      const data = await response.json();
      logger.info(`[INOREADER-API] getUserInfo SUCCESS`);
      return data;
    } catch (error) {
      logger.error("Error fetching user info", error);
      throw error;
    }
  }

  /**
   * Fetch subscription list with folder/label information
   */
  async getSubscriptions(): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const url = "https://www.inoreader.com/reader/api/0/subscription/list";

    logger.info(`[INOREADER-API] getSubscriptions called`);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[INOREADER-API] getSubscriptions FAILED: ${response.status}`, { errorText });
        throw new Error(
          `Failed to fetch subscriptions: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      // Log rate limit info
      const rateLimits = extractRateLimitInfo(response);
      logRateLimitInfo(rateLimits, 'getSubscriptions');

      const data = await response.json();
      logger.info(`[INOREADER-API] getSubscriptions SUCCESS`, {
        subscriptionCount: Array.isArray((data as {subscriptions?: unknown[]}).subscriptions) ? (data as {subscriptions: unknown[]}).subscriptions.length : 0,
      });
      return data;
    } catch (error) {
      logger.error("Error fetching subscriptions", error);
      throw error;
    }
  }
}

export function createInoreaderClient(): InoreaderClient {
  return new InoreaderClient();
}
