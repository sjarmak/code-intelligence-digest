/**
 * NextAuth v5 configuration
 * Sign in with Google; optional legacy UI_PASSWORD cookie is accepted in middleware.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { logger } from "@/src/lib/logger";

const rawSecret = (process.env.AUTH_SECRET ?? "").trim();
const authSecret =
  rawSecret.length > 0
    ? rawSecret
    : process.env.NODE_ENV === "development"
      ? "dev-secret-replace-with-AUTH_SECRET-in-env"
      : undefined;

const googleId = (process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID ?? "").trim();
const googleSecret = (process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
const googleEnabled = googleId.length > 0 && googleSecret.length > 0;

/** Comma-separated emails allowed as test accounts (e.g. personal Gmail for multi-account testing). When set, Google picker is not restricted to HD. */
const authTestEmails = (process.env.AUTH_TEST_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Use Google hosted domain only when no test emails are configured (production: only @sourcegraph.com). */
const useGoogleHd = process.env.AUTH_GOOGLE_HD && authTestEmails.length === 0;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  debug: process.env.NODE_ENV === "development",
  providers: [
    ...(googleEnabled
      ? [
          Google({
            clientId: googleId,
            clientSecret: googleSecret,
            authorization: {
              params: {
                ...(useGoogleHd ? { hd: process.env.AUTH_GOOGLE_HD } : {}),
              },
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/login",
    signOut: "/signout",
    error: "/login",
  },
  callbacks: {
    signIn({ user }) {
      const email = (user?.email ?? "").trim().toLowerCase();
      logger.info("[Auth] signIn callback", { email: email || "(empty)", hasUser: !!user });
      if (!email) return false;
      // Allow anyone who authenticated via Google; restrict who can use the app via OAuth config (e.g. Google Cloud Console) if needed.
      return true;
    },
    authorized({ auth: session, request }) {
      // Allow if NextAuth session exists
      if (session) return true;
      // Allow legacy UI_PASSWORD cookie for migration
      const legacyCookie = request.cookies.get("ui-auth")?.value === "authenticated";
      return !!legacyCookie;
    },
    redirect({ url, baseUrl }) {
      // When behind a proxy (e.g. Render), baseUrl can be internal (localhost). Force public URL for redirects.
      const publicBase = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.RENDER_EXTERNAL_URL ?? "").trim().replace(/\/$/, "");
      const base = publicBase || baseUrl;
      let result: string;
      if (url.startsWith("/")) {
        result = `${base}${url}`;
      } else {
        try {
          const u = new URL(url);
          result = u.origin === baseUrl || !publicBase ? url : `${publicBase}${u.pathname}${u.search}`;
        } catch {
          result = url;
        }
      }
      logger.info("[Auth] redirect callback", { urlPath: url.slice(0, 80), resultPath: result.slice(0, 80) });
      return result;
    },
    session({ session, token }) {
      if (session.user) {
        // Stable id across logouts/logins: normalize email and use it as canonical user id
        const rawToken = token as Record<string, unknown>;
        const emailFromToken = typeof rawToken.email === "string" ? rawToken.email : undefined;
        const emailFromSession =
          typeof session.user.email === "string" ? session.user.email : undefined;
        const email = (emailFromToken ?? emailFromSession ?? "").trim().toLowerCase();

        session.user.id = email || "anonymous";

        if (emailFromToken) {
          session.user.email = emailFromToken;
        }
        if (typeof rawToken.email_verified === "boolean") {
          (session.user as unknown as { emailVerified?: boolean }).emailVerified =
            rawToken.email_verified as boolean;
        }
      }
      return session;
    },
    jwt({ token, profile, account }) {
      logger.info("[Auth] jwt callback", {
        hasProfile: !!profile,
        hasAccount: !!account,
        trigger: account ? "oauth_callback" : "session_refresh",
      });
      if (profile && "email" in profile && profile.email != null)
        (token as Record<string, unknown>).email = String(profile.email).trim().toLowerCase();
      const p = profile as { email_verified?: boolean } | undefined;
      if (typeof p?.email_verified === "boolean") (token as Record<string, unknown>).email_verified = p.email_verified;
      if (account?.sub != null) (token as Record<string, unknown>).sub = String(account.sub);
      return token;
    },
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
  // Chrome on mobile can block session cookie on OAuth redirect; SameSite=None + Secure fixes it (HTTPS only)
  ...(process.env.NODE_ENV === "production"
    ? {
        cookies: {
          sessionToken: {
            options: {
              sameSite: "none" as const,
              secure: true,
            },
          },
        },
      }
    : {}),
});
