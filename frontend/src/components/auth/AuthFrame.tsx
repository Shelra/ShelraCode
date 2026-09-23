import type { ReactNode } from "react";
import { Noise } from "@/components/layout/Noise";
import { Wordmark } from "@/components/ui/Wordmark";
import { authCopy } from "@/lib/content";
import styles from "./AuthFrame.module.css";

type Props = {
  children: ReactNode;
  /** The visual on the right (below the panel on tablet and phone). */
  scene?: ReactNode;
  /** When given, the top-right link signs the user out instead of leading home. */
  signOutAction?: (formData: FormData) => Promise<void>;
};

/*
 * The focused frame of the auth pages: the site's logo and noise, one link at
 * the top right, and a two-column stage for the panel and its scene. No
 * marketing navigation or footer, so the page stays on the task.
 */
export function AuthFrame({ children, scene, signOutAction }: Props) {
  return (
    <div className={styles.frame}>
      <Noise />
      <header className={styles.top}>
        <div className={styles.topInner}>
          <a href="/" className={styles.logo} aria-label="Home">
            <Wordmark size={20} />
          </a>
          {signOutAction ? (
            <form action={signOutAction} className={styles.topForm}>
              <button type="submit" className={`t-small-strong pre ${styles.topButton}`}>
                {authCopy.account.signOut}
              </button>
            </form>
          ) : (
            <p className="t-small-strong pre">
              <a href="/" className="link-nav">
                {authCopy.back}
              </a>
            </p>
          )}
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.panel}>{children}</div>
        {scene && <div className={styles.scene}>{scene}</div>}
      </main>
    </div>
  );
}
