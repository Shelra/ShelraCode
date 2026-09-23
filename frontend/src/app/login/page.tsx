import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { AuthScene } from "@/components/auth/AuthScene";
import { signInWith, signInWithPassword } from "@/lib/auth-actions";
import { type AuthSearchParams, readAuthSearch } from "@/lib/auth-page";
import { getAuthProviders, providerLabel } from "@/lib/auth-providers";
import { authCopy } from "@/lib/content";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const session = await auth().catch(() => null);
  if (session?.user) redirect("/account");
  const { error, provider, redirectTo } = readAuthSearch(await searchParams);

  return (
    <AuthFrame scene={<AuthScene lines={authCopy.login.card} />}>
      <AuthPanel
        mode="login"
        providers={getAuthProviders()}
        action={signInWith}
        passwordAction={signInWithPassword}
        redirectTo={redirectTo}
        error={error ? { code: error, provider, providerName: providerLabel(provider) } : undefined}
      />
    </AuthFrame>
  );
}
