import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** Base URL for redirects. Prefer env so we never redirect to internal host (e.g. localhost:10000 on Render). */
function getBaseUrl(request: NextRequest): string {
  const fromAuth = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (fromAuth) return fromAuth;
  // Render sets this automatically; use it so sign-out doesn't redirect to localhost
  const renderUrl = (process.env.RENDER_EXTERNAL_URL ?? '').trim().replace(/\/$/, '');
  if (renderUrl) return renderUrl;
  return request.nextUrl.origin;
}

/** Clear legacy ui-auth cookie and redirect to NextAuth signout (which then redirects to /login). */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');
  const base = getBaseUrl(request);
  return NextResponse.redirect(`${base}/api/auth/signout?callbackUrl=${encodeURIComponent(`${base}/login`)}`);
}

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');
  return NextResponse.json({ success: true });
}

