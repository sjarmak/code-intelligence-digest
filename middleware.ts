import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/src/auth";

// Paths that do not require authentication
const PUBLIC_PATHS = [
  "/login",
  "/api/health",
  "/api/config",
  "/api/auth-config",
];
const PUBLIC_PREFIXES = [
  "/api/auth/",
  "/api/admin/populate-embeddings",
  "/api/admin/refresh-feeds",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = req.auth as { user?: { email?: string } } | null;
  const legacyCookie = req.cookies.get("ui-auth")?.value === "authenticated";
  const isAuthenticated = !!session?.user || legacyCookie;

  if (!isAuthenticated) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

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

