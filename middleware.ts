import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/src/auth";
import { isValidAdminToken } from "@/src/lib/auth/admin-token";

// Paths that do not require authentication
const PUBLIC_PATHS = [
  "/login",
  "/api/health",
  "/api/config",
  "/api/auth-config",
];
const PUBLIC_PREFIXES = [
  "/api/auth/",
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

// Local-dev convenience: skip the auth gate when LOCAL_NO_AUTH=true.
// Hard-guarded to non-production so it can never disable auth on a deployment.
const LOCAL_NO_AUTH =
  process.env.LOCAL_NO_AUTH === "true" && process.env.NODE_ENV !== "production";

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  if (LOCAL_NO_AUTH) return NextResponse.next();
  if (isPublic(pathname)) return NextResponse.next();

  // Admin endpoints accept a bearer token so external cron/curl callers can
  // reach them without a browser session. Routes still apply their own
  // guards (blockInProduction / requireAdminToken).
  if (
    pathname.startsWith("/api/admin/") &&
    isValidAdminToken(req.headers.get("authorization"))
  ) {
    return NextResponse.next();
  }

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
     * Match all request paths except:
     * - api/auth/* (OAuth callback etc. - skip middleware to avoid session resolution hanging on mobile)
     * - _next/static, _next/image, favicon.ico, static assets
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

