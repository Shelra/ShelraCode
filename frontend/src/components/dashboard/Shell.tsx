"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { MenuIcon, XIcon } from "@/components/ui/Icons";
import { Wordmark } from "@/components/ui/Wordmark";
import { relative } from "@/lib/demo/format";
import { useSimulation } from "@/lib/demo/simulation";
import { markNotificationsRead, resetDemo, useDemo } from "@/lib/demo/store";
import { planLimits } from "@/lib/demo/types";
import { CommandPalette } from "./CommandPalette";
import { creditsUsed } from "./helpers";
import { BellIcon, LogOutIcon, SearchIcon, SettingsIcon, UserIcon } from "./icons";
import { useIdentity } from "./identity";
import { activeItem, navGroups } from "./nav";
import styles from "./Shell.module.css";
import { Avatar, Kbd, ProgressBar, ToastProvider, useToast } from "./ui";

/*
 * The dashboard frame: a hairline sidebar with the workspace and its
 * navigation, a sticky top bar (breadcrumb, ⌘K search, new mission,
 * notifications, account) and the page. The demo simulation ticks while a
 * dashboard page is open.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  useSimulation();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the drawer closes on every navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setPalette(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <Sidebar open={open} onClose={() => setOpen(false)} pathname={pathname} />
        <AnimatePresence>
          {open && (
            <motion.div
              className={styles.backdrop}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
          )}
        </AnimatePresence>
        <div className={styles.main}>
          <Topbar pathname={pathname} onMenu={() => setOpen(true)} onSearch={() => setPalette(true)} />
          <DemoBanner />
          <main className={styles.content}>{children}</main>
        </div>
        <CommandPalette open={palette} onClose={() => setPalette(false)} />
      </div>
    </ToastProvider>
  );
}

function Sidebar({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  const state = useDemo();
  const workspace = state?.workspace;
  const used = state ? creditsUsed(state) : 0;
  const included = workspace ? workspace.creditsIncluded + workspace.creditsAddOn : 1;
  return (
    <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`} aria-label="Dashboard navigation">
      <div className={styles.brand}>
        <a href="/" className={styles.logo} aria-label="Home">
          <Wordmark size={18} />
        </a>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close menu">
          <XIcon size={20} color="var(--default)" />
        </button>
      </div>
      <nav className={styles.nav}>
        {navGroups.map((group) => (
          <div key={group.label} className={styles.group}>
            <p className={`t-small-mono pre ${styles.groupLabel}`}>[ {group.label} ]</p>
            {group.items.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`${styles.item} ${active ? styles.itemActive : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} color={active ? "var(--accent)" : "currentColor"} />
                  <span className="t-small-strong pre">{item.label}</span>
                </a>
              );
            })}
          </div>
        ))}
      </nav>
      <div className={styles.foot}>
        {workspace && (
          <a href="/dashboard/billing" className={`fb ${styles.workspace}`}>
            <div className={styles.workspaceRow}>
              <p className="t-small-strong pre">{workspace.name}</p>
              <p className={`t-small-mono pre ${styles.plan}`}>{planLimits[workspace.plan].name}</p>
            </div>
            <ProgressBar value={used / included} warn={used / included > 0.85} />
            <p className={`t-small-mono pre ${styles.credits}`}>
              {Math.round(used).toLocaleString("en-US")} / {included.toLocaleString("en-US")} credits
            </p>
          </a>
        )}
      </div>
    </aside>
  );
}

function Topbar({ pathname, onMenu, onSearch }: { pathname: string; onMenu: () => void; onSearch: () => void }) {
  const item = activeItem(pathname);
  const tail = item && pathname !== item.href ? pathname.slice(item.href.length + 1).split("/")[0] : null;
  return (
    <header className={styles.topbar}>
      <button type="button" className={styles.menuButton} onClick={onMenu} aria-label="Open menu">
        <MenuIcon size={22} color="var(--default)" />
      </button>
      <div className={styles.crumbs}>
        <p className={`t-small-mono pre ${styles.crumbBadge}`}>[ {item?.badge ?? "DASHBOARD"} ]</p>
        {tail && (
          <>
            <span className={`t-small-mono pre ${styles.crumbSep}`}>/</span>
            <p className={`t-small-mono pre ${styles.crumbTail}`}>{tail}</p>
          </>
        )}
      </div>
      <button type="button" className={styles.search} onClick={onSearch}>
        <SearchIcon size={16} color="var(--subtle)" />
        <span className={`t-small-strong pre ${styles.searchLabel}`}>Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className={styles.newMission}>
        <Button text="New mission" href="/dashboard/missions/new" variant="primary-sm" newTab={false} />
      </div>
      <Notifications />
      <AccountMenu />
    </header>
  );
}

function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

const pop = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { type: "tween", duration: 0.25, ease: [0.12, 0.23, 0.17, 0.99] } as const,
};

function Notifications() {
  const state = useDemo();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const items = state?.notifications ?? [];
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className={styles.popWrap} ref={ref}>
      <button
        type="button"
        className={styles.iconButton}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications (${unread} unread)`}
      >
        <BellIcon size={18} color="var(--default)" />
        {unread > 0 && <span className={styles.badge}>{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className={`fb ${styles.pop}`} {...pop}>
            <div className={styles.popHead}>
              <p className="t-small-mono pre" style={{ color: "var(--accent)" }}>
                [ NOTIFICATIONS ]
              </p>
              {unread > 0 && (
                <button
                  type="button"
                  className={`t-small-mono pre ${styles.popAction}`}
                  onClick={() => markNotificationsRead()}
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className={styles.popList}>
              {items.slice(0, 8).map((n) => (
                <a
                  key={n.id}
                  href={n.href ?? "#"}
                  className={`${styles.notification} ${n.read ? styles.read : ""}`}
                  onClick={() => {
                    markNotificationsRead(n.id);
                    setOpen(false);
                  }}
                >
                  <span className={styles.notificationDot} />
                  <span className={styles.notificationText}>
                    <span className="t-small-strong wrap">{n.title}</span>
                    <span className="t-body wrap">{n.body}</span>
                    <span className={`t-small-mono pre ${styles.time}`}>{relative(n.t)}</span>
                  </span>
                </a>
              ))}
              {items.length === 0 && <p className={`t-body ${styles.popEmpty}`}>Nothing yet.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AccountMenu() {
  const me = useIdentity();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  return (
    <div className={styles.popWrap} ref={ref}>
      <button
        type="button"
        className={styles.avatarButton}
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
      >
        <Avatar name={me.name} image={me.image} size={30} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className={`fb ${styles.pop} ${styles.popNarrow}`} {...pop}>
            <div className={styles.me}>
              <p className="t-small-strong wrap">{me.name}</p>
              <p className="t-body wrap">{me.signedIn ? me.email : "Demo workspace · not signed in"}</p>
            </div>
            <a href="/dashboard/settings" className={styles.menuItem}>
              <SettingsIcon size={16} color="currentColor" />
              <span className="t-small-strong pre">Settings</span>
            </a>
            {me.signedIn ? (
              <>
                <a href="/account" className={styles.menuItem}>
                  <UserIcon size={16} color="currentColor" />
                  <span className="t-small-strong pre">Account</span>
                </a>
                <button type="button" className={styles.menuItem} onClick={() => signOut({ redirectTo: "/" })}>
                  <LogOutIcon size={16} color="currentColor" />
                  <span className="t-small-strong pre">Sign out</span>
                </button>
              </>
            ) : (
              <a href="/login?callbackUrl=%2Fdashboard" className={styles.menuItem}>
                <UserIcon size={16} color="currentColor" />
                <span className="t-small-strong pre">Sign in</span>
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DemoBanner() {
  const me = useIdentity();
  const toast = useToast();
  if (me.signedIn || me.loading) return null;
  return (
    <div className={styles.banner}>
      <p className={`t-small-mono pre ${styles.bannerCmd}`}>$ demo mode</p>
      <p className={`t-body wrap ${styles.bannerText}`}>
        This workspace is simulated in your browser. Sign in to make it yours.
      </p>
      <a href="/login?callbackUrl=%2Fdashboard" className={`t-small-strong pre ${styles.bannerLink}`}>
        Sign in
      </a>
      <button
        type="button"
        className={`t-small-strong pre ${styles.bannerLink}`}
        onClick={() => {
          resetDemo();
          toast("Demo data reset");
        }}
      >
        Reset data
      </button>
    </div>
  );
}
