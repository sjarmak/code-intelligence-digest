import { handlers } from "@/src/auth";

// Run in Node so AUTH_* env vars are available (middleware runs in Edge and may not have them)
export const runtime = "nodejs";

export const { GET, POST } = handlers;
