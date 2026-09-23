/*
 * Which sign-in providers this deployment can offer. A provider counts as
 * configured when Auth.js has a secret and the provider's standard
 * AUTH_<PROVIDER>_ID / AUTH_<PROVIDER>_SECRET variables; nothing secret leaves
 * this module, only the flags. Server-side only (reads process.env).
 */
export type AuthProviderId = "github" | "google";

export type AuthProviderInfo = {
  id: AuthProviderId;
  name: string;
  configured: boolean;
};

const hasSecret = () => Boolean(process.env.AUTH_SECRET) || process.env.NODE_ENV === "development";

export function getAuthProviders(): AuthProviderInfo[] {
  const secret = hasSecret();
  return [
    {
      id: "github",
      name: "GitHub",
      configured: secret && Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
    },
    {
      id: "google",
      name: "Google",
      configured: secret && Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    },
  ];
}

export function providerLabel(id?: string): string {
  if (id === "github") return "GitHub";
  if (id === "google") return "Google";
  if (id === "credentials") return "Email";
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : "your provider";
}
