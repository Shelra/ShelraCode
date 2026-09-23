"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDemo } from "@/lib/demo/store";
import styles from "./CommandPalette.module.css";
import { SearchIcon } from "./icons";
import { navItems } from "./nav";
import { Kbd, StatusPill } from "./ui";

type Result = { id: string; group: string; label: string; hint?: string; href: string; status?: string };

/*
 * ⌘K: jump to a page, a mission, a repository or an agent. Keyboard first, like
 * the product: type, arrow keys, enter.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useDemo();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (text: string) => !q || text.toLowerCase().includes(q);
    const pages: Result[] = [
      ...navItems
        .filter((n) => match(n.label))
        .map((n) => ({ id: n.href, group: "Pages", label: n.label, href: n.href })),
      ...(match("new mission")
        ? [
            {
              id: "new",
              group: "Pages",
              label: "New mission",
              hint: "Start a mission",
              href: "/dashboard/missions/new",
            },
          ]
        : []),
    ];
    if (!state) return pages;
    const missions = state.missions
      .filter((m) => match(`${m.title} ${m.id}`))
      .slice(0, q ? 8 : 4)
      .map((m) => ({
        id: m.id,
        group: "Missions",
        label: m.title,
        hint: state.repos.find((r) => r.id === m.repoId)?.fullName,
        href: `/dashboard/missions/${m.id}`,
        status: m.status,
      }));
    const repos = state.repos
      .filter((r) => match(r.fullName))
      .slice(0, 4)
      .map((r) => ({ id: r.id, group: "Repositories", label: r.fullName, hint: r.language, href: "/dashboard/repos" }));
    const agents = state.agents
      .filter((a) => match(a.name))
      .slice(0, 4)
      .map((a) => ({
        id: a.id,
        group: "Agents",
        label: a.name,
        hint: a.model,
        href: `/dashboard/agents/${a.id}`,
        status: a.status,
      }));
    return [...pages, ...missions, ...repos, ...agents];
  }, [query, state]);

  const go = (r: Result) => {
    onClose();
    router.push(r.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[index]) {
      e.preventDefault();
      go(results[index]);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            className={`fb ${styles.palette}`}
            role="dialog"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "tween", duration: 0.2, ease: [0.12, 0.23, 0.17, 0.99] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.inputRow}>
              <SearchIcon size={18} color="var(--subtle)" />
              <input
                ref={inputRef}
                className={styles.input}
                placeholder="Search missions, repos, agents, pages…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIndex(0);
                }}
                onKeyDown={onKey}
                aria-label="Search"
              />
              <Kbd>esc</Kbd>
            </div>
            <div className={styles.list} role="listbox">
              {results.length === 0 && <p className={`t-body ${styles.empty}`}>No matches.</p>}
              {results.map((r, i) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <div key={r.id + r.group}>
                    {header && <p className={`t-small-mono pre ${styles.group}`}>[ {header.toUpperCase()} ]</p>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === index}
                      className={`${styles.item} ${i === index ? styles.itemActive : ""}`}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => go(r)}
                    >
                      <span className={`t-small-strong pre ${styles.label}`}>{r.label}</span>
                      {r.hint && <span className={`t-small-mono pre ${styles.hint}`}>{r.hint}</span>}
                      {r.status && <StatusPill status={r.status} />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={styles.foot}>
              <span className={`t-small-mono pre ${styles.hint}`}>
                <Kbd>↑↓</Kbd> navigate · <Kbd>↵</Kbd> open · <Kbd>/</Kbd> search
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
