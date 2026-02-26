/**
 * GET /api/auth-config
 * Returns which sign-in methods are configured (no secrets).
 * Used by the login page to show/hide "Sign in with Google".
 */
import { NextResponse } from "next/server";

export async function GET() {
  const googleId = (
    process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? ""
  ).trim();
  const googleSecret = (
    process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? ""
  ).trim();
  const googleEnabled = googleId.length > 0 && googleSecret.length > 0;

  return NextResponse.json({
    googleEnabled,
  });
}
