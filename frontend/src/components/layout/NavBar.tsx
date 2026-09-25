"use client";

import { AnimatePresence, motion } from "motion/react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { GitHubStars } from "@/components/ui/GitHubStars";
import { MenuIcon, XIcon } from "@/components/ui/Icons";
import { Wordmark } from "@/components/ui/Wordmark";
import { links, mobileNav, nav } from "@/lib/content";
import { appEnabled } from "@/lib/features";
import { useBreakpoint } from "@/lib/useBreakpoint";
import styles from "./NavBar.module.css";

type Props = {
  /** Id of the section past which the CTA switches to the filled variant. */
  switchAt?: string;
  /** The repository's star count, read on the server (lib/github.ts); null when GitHub could not be read. */
  stars: number | null;
};

// Fixed top navigation with the mobile overlay menu.
export function NavBar({ switchAt, stars }: Props) {
  const bp = useBreakpoint();
  const mobile = bp !== "desktop";
  const [open, setOpen] = useState(false);
  const [passed, setPassed] = useState(false);

  // The "Get Started" button turns solid once the page scrolls past `switchAt`.
  useEffect(() => {
    if (!switchAt) return;
    const check = () => {
      const el = document.getElementById(switchAt);
      if (!el) return;
      setPassed(el.getBoundingClientRect().top <= 0);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [switchAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!mobile) setOpen(false);
  }, [mobile]);

  return (
    <>
      <div className={styles.fixed}>
        <nav className={`${styles.nav} ${mobile ? styles.navMobile : ""}`}>
          <div className={styles.inner}>
            <div className={styles.links}>
              <a href="/" className={styles.logo}>
                <Wordmark size={20} />
              </a>
            </div>
            {!mobile && (
              <div className={styles.menu}>
                {nav.map((item) => (
                  <p key={item.label} className="t-small-strong pre">
                    <a href={item.href} className="link-nav">
                      {item.label}
                    </a>
                  </p>
                ))}
              </div>
            )}
            {!mobile && (
              <div className={styles.actions}>
                {appEnabled && <NavAuth />}
                <GitHubStars stars={stars} />
                <Button
                  text="Get Started"
                  href={links.getStarted}
                  variant={passed ? "primary-sm" : "secondary-sm"}
                  newTab={false}
                />
              </div>
            )}
            {mobile && (
              <div className={styles.mobileActions}>
                <GitHubStars stars={stars} compact />
                <button
                  type="button"
                  className={styles.hamburger}
                  onClick={() => setOpen((v) => !v)}
                  aria-label="Open menu"
                >
                  <MenuIcon size={24} strokeWidth={2} color="var(--default)" />
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              className={styles.backdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0 } }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="menu"
              className={styles.overlay}
              initial={{ opacity: 0, y: 720 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 720 }}
              transition={{ type: "spring", damping: 30, stiffness: 220, mass: 1 }}
            >
              {appEnabled ? (
                <MobileMenuWithAccount onClose={() => setOpen(false)} />
              ) : (
                <MobileMenu onClose={() => setOpen(false)} />
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/*
 * The account entry of the navbar: "Sign in" for visitors, the avatar (or the
 * initials) linking to the account once the session is known. Nothing is
 * rendered while the session loads so the wrong state never flashes.
 */
function NavAuth() {
  const { data, status } = useSession();
  if (status === "loading") return null;
  const user = data?.user;
  if (!user) {
    return (
      <p className={`t-small-strong pre ${styles.authIn}`}>
        <a href="/login" className="link-nav">
          Sign in
        </a>
      </p>
    );
  }
  const title = user.name ?? user.email ?? "Account";
  return (
    <a
      href="/dashboard"
      className={`fb ${styles.avatar} ${styles.authIn}`}
      aria-label={`Account: ${title}`}
      title={title}
    >
      {user.image ? (
        <img src={user.image} alt="" width={28} height={28} referrerPolicy="no-referrer" />
      ) : (
        <span className={styles.initials}>{title.charAt(0).toUpperCase()}</span>
      )}
    </a>
  );
}

// The mobile menu with the account entry, when the web app is on (lib/features.ts).
function MobileMenuWithAccount({ onClose }: { onClose: () => void }) {
  const { data } = useSession();
  const account = data?.user ? { label: "Dashboard", href: "/dashboard" } : { label: "Sign in", href: "/login" };
  return <MobileMenu onClose={onClose} account={account} />;
}

function MobileMenu({ onClose, account }: { onClose: () => void; account?: { label: string; href: string } }) {
  return (
    <div className={styles.mobileMenu}>
      <div className={styles.mobileLinks}>
        {[...mobileNav, ...(account ? [account] : [])].map((item, i) => (
          <div key={item.label} className={styles.mobileRow}>
            <motion.p
              className={`t-h1 pre ${styles.mobileLink}`}
              initial={{ y: 160, opacity: 1 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", damping: 40, stiffness: 200, mass: 1, delay: 0.2 + 0.1 * i }}
              onClick={onClose}
            >
              <a href={item.href} className="link-footer">
                {item.label}
              </a>
            </motion.p>
          </div>
        ))}
      </div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close menu">
        <XIcon size={24} strokeWidth={2} color="var(--default)" />
      </button>
    </div>
  );
}
