"use client";

import { useSession } from "next-auth/react";

/*
 * Who is looking at the dashboard: the signed-in user when there is a session,
 * otherwise the demo workspace's owner (the dashboard is simulated in the
 * browser, so it can be explored without an account).
 */
export type Identity = { name: string; email: string; image: string | null; signedIn: boolean; loading: boolean };

export function useIdentity(): Identity {
  const { data, status } = useSession();
  const user = data?.user;
  if (user) {
    return {
      name: user.name ?? user.email ?? "You",
      email: user.email ?? "",
      image: user.image ?? null,
      signedIn: true,
      loading: false,
    };
  }
  return { name: "Ada Lovelace", email: "ada@acme.dev", image: null, signedIn: false, loading: status === "loading" };
}
