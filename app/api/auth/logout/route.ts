import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** Base URL for redirects when we have it from env (server redirect). */
function getBaseUrl(request: NextRequest): string {
  const fromAuth = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? '').trim().replace(/\/$/, '');
  if (fromAuth) return fromAuth;
  const renderUrl = (process.env.RENDER_EXTERNAL_URL ?? '').trim().replace(/\/$/, '');
  if (renderUrl) return renderUrl;
  return request.nextUrl.origin;
}

/**
 * Sign-out: clear ui-auth cookie, then redirect to NextAuth signout.
 * When behind a proxy (e.g. Render), request.nextUrl.origin can be internal (localhost:10000).
 * So we return HTML that redirects using the client's origin (the public URL the user actually sees).
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');

  const base = getBaseUrl(request);
  const isLikelyInternal = /localhost|127\.0\.0\.1/i.test(base);

  if (!isLikelyInternal) {
    return NextResponse.redirect(`${base}/api/auth/signout?callbackUrl=${encodeURIComponent(`${base}/login`)}`);
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing out...</title></head><body><p>Signing out...</p><script>
(function(){
  document.cookie = 'ui-auth=; path=/; max-age=0';
  var origin = window.location.origin;
  var callback = encodeURIComponent(origin + '/login');
  window.location.replace(origin + '/api/auth/signout?callbackUrl=' + callback);
})();
</script></body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete('ui-auth');
  return NextResponse.json({ success: true });
}

