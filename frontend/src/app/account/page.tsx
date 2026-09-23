import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountPanel } from "@/components/auth/AccountPanel";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { AuthScene } from "@/components/auth/AuthScene";
import { signOutAction } from "@/lib/auth-actions";
import { providerLabel } from "@/lib/auth-providers";
import { authCopy, type CardLine } from "@/lib/content";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const session = await auth().catch(() => null);
  if (!session?.user) redirect("/login?callbackUrl=%2Faccount");

  const user = {
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
  };
  const provider = providerLabel(session.provider);
  const expires = new Date(session.expires).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const card = authCopy.account.card;
  const lines: CardLine[] = [
    { type: "cmd", text: card.whoami },
    { type: "out", text: `> ${user.name ?? user.email ?? ""}` },
    { type: "out", text: `> Provider: ${provider}` },
    { type: "rule" },
    { type: "ok", text: card.signedIn },
    { type: "live", text: `${card.session} ${expires}` },
  ];

  return (
    <AuthFrame signOutAction={signOutAction} scene={<AuthScene lines={lines} />}>
      <AccountPanel user={user} provider={provider} expires={expires} signOut={signOutAction} />
    </AuthFrame>
  );
}
