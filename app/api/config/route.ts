/**
 * GET /api/config
 * Public configuration endpoint - returns safe client-side config
 * Used by UI to know production mode, feature flags, etc.
 */

import { NextResponse } from "next/server";
import { isProduction, isAdminUIEnabled } from "@/src/lib/auth/guards";

export async function GET() {
  return NextResponse.json({
    isProduction: isProduction(),
    adminUIEnabled: isAdminUIEnabled(),
    features: {
      search: true,
      qa: true,
      starred: !isProduction(), // Starred tab only in dev
    },
  });
}
