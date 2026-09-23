import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { getAuthProviders } from "@/lib/auth-providers";
import { findUserByEmail, normalizeEmail, passwordAuthAvailable, verifyPassword } from "@/lib/users";

/*
 * Auth.js: GitHub and Google sign-in plus email + password (users in libSQL,
 * see lib/users.ts), all with stateless (JWT) sessions. A provider without
 * credentials is left out here and shown as "not configured" on the sign-in
 * page instead of failing, and a missing AUTH_SECRET never breaks the marketing
 * pages (development gets a fixed one; production simply has no working
 * sign-in until it is set).
 */
const configured = new Set(
  getAuthProviders()
    .filter((p) => p.configured)
    .map((p) => p.id),
);
const providers: NextAuthConfig["providers"] = [];
if (configured.has("github")) providers.push(GitHub);
if (configured.has("google")) providers.push(Google);
if (passwordAuthAvailable()) {
  providers.push(
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email);
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const user = await findUserByEmail(email);
        if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "development" ? "development-only-secret" : undefined),
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    jwt({ token, account }) {
      // Remember which provider the account came from; the account page shows it.
      if (account) token.provider = account.provider;
      return token;
    },
    session(params) {
      const token = "token" in params ? params.token : undefined;
      params.session.provider = typeof token?.provider === "string" ? token.provider : undefined;
      return params.session;
    },
  },
});
