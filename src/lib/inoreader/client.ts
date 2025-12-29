/**
 * Inoreader API client
 * 
 * Simplified: No internal budget tracking - rely on Inoreader's 429 errors for rate limiting
 */

import { InoreaderStreamResponse, InoreaderTokenResponse } from "./types.js";
import { logger } from "../logger";

export interface FetchStreamOptions {
  n?: number;
  continuation?: string;
  xt?: string;  // Exclude tag (e.g., read items)
  ot?: number;  // Oldest timestamp (unix epoch seconds)
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

    const url = `https://www.inoreader.com/reader/api/0/stream/contents/${encodedStreamId}?${params.toString()}`;

    logger.debug(`Fetching Inoreader stream: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch stream contents: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      return (await response.json()) as InoreaderStreamResponse;
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

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch user info: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      return await response.json();
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

    logger.debug("Fetching Inoreader subscriptions...");

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch subscriptions: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      return await response.json();
    } catch (error) {
      logger.error("Error fetching subscriptions", error);
      throw error;
    }
  }
}

export function createInoreaderClient(): InoreaderClient {
  return new InoreaderClient();
}
