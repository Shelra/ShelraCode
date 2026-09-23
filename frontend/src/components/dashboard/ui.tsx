"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { XIcon } from "@/components/ui/Icons";
import { SectionBadge } from "@/components/ui/SectionBadge";
import { initials } from "@/lib/demo/format";
import { ChevronDownIcon } from "./icons";
import styles from "./ui.module.css";

/* The dashboard's building blocks, in the site's language: hairline panels,
 * [ MONO ] labels, mono numbers, green for the live and the done. */

const ease = [0.12, 0.23, 0.17, 0.99] as const;

export function Panel({
  title,
  meta,
  actions,
  children,
  flush = false,
  className,
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`fb ${styles.panel} ${className ?? ""}`}>
      {(title || actions) && (
        <div className={styles.panelHead}>
          <div className={styles.panelMeta}>
            {title && <SectionBadge text={title} />}
            {meta && <p className={`t-small-mono pre ${styles.subtle}`}>{meta}</p>}
          </div>
          {actions && <div className={styles.panelMeta}>{actions}</div>}
        </div>
      )}
      <div className={`${styles.panelBody} ${flush ? styles.flush : ""}`}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  status,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div className={styles.pageHead}>
      <div className={styles.pageTexts}>
        <div className={styles.pageTitleRow}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {status}
        </div>
        {subtitle && <p className={`t-small ${styles.pageSubtitle}`}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </div>
  );
}

export function Grid({ children, min = 220 }: { children: ReactNode; min?: number }) {
  return (
    <div className={styles.grid} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {children}
    </div>
  );
}

export function Columns({ children, ratio = "2fr 1fr" }: { children: ReactNode; ratio?: string }) {
  return (
    <div className={styles.columns} style={{ "--cols": ratio } as React.CSSProperties}>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={i} className={styles.skeletonRow} />
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  trend,
  hint,
  progress,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  hint?: string;
  progress?: number;
}) {
  return (
    <div className={`fb ${styles.stat}`}>
      <p className={`t-small-mono pre ${styles.statLabel}`}>{label}</p>
      <div className={styles.statRow}>
        <p className={styles.statValue}>{value}</p>
        {delta && <p className={`t-small-mono pre ${styles.statDelta} ${trend ? styles[trend] : ""}`}>{delta}</p>}
      </div>
      {progress !== undefined && <ProgressBar value={progress} warn={progress > 0.85} />}
      {hint && <p className={`t-small-mono wrap ${styles.subtle}`}>{hint}</p>}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  running: "Running",
  queued: "Queued",
  review: "Needs review",
  merged: "Merged",
  failed: "Paused",
  cancelled: "Cancelled",
  connected: "Connected",
  syncing: "Syncing",
  error: "Error",
  idle: "Idle",
  paused: "Paused",
  active: "Active",
  invited: "Invited",
  paid: "Paid",
  open: "Open",
  passed: "Passed",
  pending: "Pending",
  revoked: "Revoked",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`t-small-mono pre ${styles.pill} ${styles[status] ?? ""}`}>
      <span className={styles.dot} />
      {label ?? statusLabels[status] ?? status}
    </span>
  );
}

export function ProgressBar({ value, warn = false }: { value: number; warn?: boolean }) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  return (
    <div className={styles.progress}>
      <div className={`${styles.progressFill} ${warn ? styles.progressWarn : ""}`} style={{ width }} />
    </div>
  );
}

export type Column = { label: string; align?: "right" };
export type Row = { key: string; cells: ReactNode[]; href?: string; onClick?: () => void };

export function Table({ columns, rows, empty }: { columns: Column[]; rows: Row[]; empty?: ReactNode }) {
  const router = useRouter();
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`${styles.th} ${c.align === "right" ? styles.right : ""}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={row.href || row.onClick ? styles.rowLink : undefined}
              onClick={row.onClick ?? (row.href ? () => router.push(row.href as string) : undefined)}
            >
              {row.cells.map((cell, i) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                  key={i}
                  className={`${styles.td} ${columns[i]?.align === "right" ? styles.right : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Mono({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
  return <span className={`${styles.mono} ${subtle ? styles.subtle : ""}`}>{children}</span>;
}

export function EmptyState({
  command,
  title,
  body,
  action,
}: {
  command: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <p className="t-body-mono pre" style={{ color: "var(--accent)" }}>
        {command}
      </p>
      <p className="t-body-strong wrap">{title}</p>
      {body && <p className="t-body wrap">{body}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the caller's child of this label
    <label className={styles.field}>
      <span className={`t-small-mono pre ${styles.label}`}>{label}</span>
      {children}
      {hint && <span className={`t-small-mono wrap ${styles.hint}`}>{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${styles.input} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${styles.textarea} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={styles.selectWrap}>
      <select {...props} className={`${styles.select} ${props.className ?? ""}`} />
      <ChevronDownIcon size={16} color="var(--subtle)" className={styles.selectIcon} />
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`t-small-strong ${styles.check}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  const titleId = useId();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className={`fb ${styles.modal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "tween", duration: 0.35, ease }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHead}>
              <h2 id={titleId} className="t-body-strong pre">
                {title}
              </h2>
              <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close">
                <XIcon size={16} color="var(--default)" />
              </button>
            </div>
            <div className={styles.modalBody}>{children}</div>
            {footer && <div className={styles.modalFoot}>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={`t-small-strong ${styles.tab} ${item.id === value ? styles.tabActive : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined && <Mono subtle>{item.count}</Mono>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, image, size = 28 }: { name: string; image?: string | null; size?: number }) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      title={name}
    >
      {image ? (
        <img src={image} alt="" width={size} height={size} referrerPolicy="no-referrer" />
      ) : (
        initials(name) || "?"
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className={styles.kbd}>{children}</span>;
}

export function Chip({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={`t-small-mono pre ${styles.chip} ${muted ? styles.chipMuted : ""}`}>{children}</span>;
}

export function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function TextButton({
  children,
  onClick,
  danger = false,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`t-small-strong pre ${styles.textButton} ${danger ? styles.danger : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function KeyValue({ rows }: { rows: { key: string; value: ReactNode }[] }) {
  return (
    <div>
      {rows.map((row) => (
        <div key={row.key} className={styles.kvRow}>
          <span className={`t-small-mono pre ${styles.subtle}`}>{row.key}</span>
          <span className="t-small-strong" style={{ textAlign: "right" }}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- toasts ----------------------------------------------------------------

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2400);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {message && (
          <motion.div
            className={`fb t-small-mono pre ${styles.toast}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "tween", duration: 0.3, ease }}
            role="status"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
