/**
 * The web app (sign-in, account and the demo dashboard) is hidden: the site is the landing page and its guides
 * until the account service ships. Its code stays; its routes answer 404, the navbar has no account entry and no
 * page asks for a session. Build with NEXT_PUBLIC_SHELRA_APP=1 to bring it back (local work on those pages).
 */
export const appEnabled = process.env.NEXT_PUBLIC_SHELRA_APP === "1";
