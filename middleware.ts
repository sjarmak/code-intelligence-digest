import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to login page and auth API routes
  if (pathname === '/login' || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Allow access to health check endpoint
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Allow access to populate-embeddings endpoint (one-time operation)
  // This endpoint generates embeddings for the database
  if (pathname.startsWith('/api/admin/populate-embeddings')) {
    return NextResponse.next();
  }

  // Check for authentication cookie
  const authCookie = request.cookies.get('ui-auth');
  const isAuthenticated = authCookie?.value === 'authenticated';

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    // Preserve the original URL for redirect after login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

