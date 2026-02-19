/**
 * NextAuth v5 configuration
 * Sign in with Google; optional legacy UI_PASSWORD cookie is accepted in middleware.
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
                ...(process.env.AUTH_GOOGLE_HD
                  ? { hd: process.env.AUTH_GOOGLE_HD }
                  : {}),
              },
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth: session, request }) {
      // Allow if NextAuth session exists
      if (session) return true;
      // Allow legacy UI_PASSWORD cookie for migration
      const legacyCookie = request.cookies.get("ui-auth")?.value === "authenticated";
      return !!legacyCookie;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? session.user.email ?? "";
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.email_verified === "boolean")
          (session.user as unknown as { emailVerified?: boolean }).emailVerified = token.email_verified;
      }
      return session;
    },
    jwt({ token, profile, account }) {
      if (profile && "email" in profile && profile.email != null)
        (token as Record<string, unknown>).email = String(profile.email);
      const p = profile as { email_verified?: boolean } | undefined;
      if (typeof p?.email_verified === "boolean") (token as Record<string, unknown>).email_verified = p.email_verified;
      if (account?.sub != null) (token as Record<string, unknown>).sub = String(account.sub);
      return token;
    },
  },
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  trustHost: true,
});
