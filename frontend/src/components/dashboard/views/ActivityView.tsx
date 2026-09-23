"use client";

import { useState } from "react";
import { dateTime, fullDate } from "@/lib/demo/format";
import { useDemo } from "@/lib/demo/store";
import type { ActivityKind } from "@/lib/demo/types";
import { Chip, EmptyState, Mono, PageHeader, Panel, Skeleton, Tabs } from "../ui";
import styles from "./views.module.css";

type Filter = "all" | ActivityKind;
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mission", label: "Missions" },
  { id: "agent", label: "Agents" },
  { id: "team", label: "Team" },
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
  { id: "integration", label: "Integrations" },
];

export function ActivityView() {
  const s = useDemo();
  const [filter, setFilter] = useState<Filter>("all");
  if (!s) return <Skeleton rows={5} />;
  const items = s.activity.filter((a) => filter === "all" || a.kind === filter);
  const days = new Map<string, typeof items>();
  for (const item of items) {
    const key = fullDate(item.t);
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every action in the workspace, by agents and by people. Exportable on Enterprise."
      />
      <Panel flush>
        <div style={{ padding: "12px 20px 0" }}>
          <Tabs
            items={filters.map((f) => ({
              id: f.id,
              label: f.label,
              count: f.id === "all" ? s.activity.length : s.activity.filter((a) => a.kind === f.id).length,
            }))}
            value={filter}
            onChange={setFilter}
          />
        </div>
        {items.length === 0 && <EmptyState command="$ shelra audit" title="Nothing here yet." />}
        {[...days.entries()].map(([day, list]) => (
          <div key={day} className={styles.day}>
            <p className={`t-small-mono pre ${styles.dayLabel}`}>[ {day.toUpperCase()} ]</p>
            {list.map((a) => (
              <div key={a.id} className={styles.activityRow}>
                <span className={styles.activityKind}>
                  <Chip muted>{a.kind}</Chip>
                </span>
                <p className={`t-small-strong wrap ${styles.activityText}`}>
                  {a.actor} <span className="muted">{a.action}</span>{" "}
                  {a.target &&
                    (a.href ? (
                      <a href={a.href} className={styles.activityLink}>
                        {a.target}
                      </a>
                    ) : (
                      a.target
                    ))}
                </p>
                <Mono subtle>{dateTime(a.t)}</Mono>
              </div>
            ))}
          </div>
        ))}
      </Panel>
    </>
  );
}
