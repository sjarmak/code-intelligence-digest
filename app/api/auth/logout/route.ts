import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** Clear legacy ui-auth cookie and redirect to NextAuth signout (which then redirects to /login). */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');
  const base = request.nextUrl.origin;
  return NextResponse.redirect(`${base}/api/auth/signout?callbackUrl=${encodeURIComponent(`${base}/login`)}`);
}

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');
  return NextResponse.json({ success: true });
}

