import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { AuthScene } from "@/components/auth/AuthScene";
import { signInWith, signUpWithPassword } from "@/lib/auth-actions";
import { type AuthSearchParams, readAuthSearch } from "@/lib/auth-page";
import { getAuthProviders, providerLabel } from "@/lib/auth-providers";
import { authCopy } from "@/lib/content";

export const metadata: Metadata = {
  title: "Create your account – ShelraCode",
  robots: { index: false, follow: false },
};

// Signing up with an OAuth provider is the same flow as signing in; the page differs in what it says.
export default async function SignupPage({ searchParams }: { searchParams: AuthSearchParams }) {
  const session = await auth().catch(() => null);
  if (session?.user) redirect("/account");
  const { error, provider, redirectTo } = readAuthSearch(await searchParams);

  return (
    <AuthFrame scene={<AuthScene lines={authCopy.signup.card} />}>
      <AuthPanel
        mode="signup"
        providers={getAuthProviders()}
        action={signInWith}
        passwordAction={signUpWithPassword}
        redirectTo={redirectTo}
        error={error ? { code: error, provider, providerName: providerLabel(provider) } : undefined}
      />
    </AuthFrame>
  );
}
