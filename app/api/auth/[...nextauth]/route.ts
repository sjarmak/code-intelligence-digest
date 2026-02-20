import type { NextRequest } from "next/server";
import { handlers } from "@/src/auth";
import { logger } from "@/src/lib/logger";

// Run in Node so AUTH_* env vars are available (middleware runs in Edge and may not have them)
export const runtime = "nodejs";

const { GET: rawGet, POST: rawPost } = handlers;

type AuthContext = { params: Promise<{ nextauth: string[] }> };

function withAuthLogging(
  method: string,
  handler: (req: NextRequest, context: AuthContext) => Promise<Response>
) {
  return async (req: NextRequest, context: AuthContext) => {
    const pathname = new URL(req.url).pathname;
    const start = Date.now();
    logger.info("[Auth] request start", { method, pathname });
    try {
      const res = await handler(req, context);
      logger.info("[Auth] request complete", { method, pathname, status: res.status, durationMs: Date.now() - start });
      return res;
    } catch (err) {
      logger.error("[Auth] request error", err);
      logger.info("[Auth] request failed", { method, pathname, durationMs: Date.now() - start });
      throw err;
    }
  };
}

export const GET = withAuthLogging("GET", rawGet);
export const POST = withAuthLogging("POST", rawPost);
