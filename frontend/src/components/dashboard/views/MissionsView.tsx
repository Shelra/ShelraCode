"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { money, relative } from "@/lib/demo/format";
import { useDemo } from "@/lib/demo/store";
import type { MissionStatus } from "@/lib/demo/types";
import { agentName, lastUpdated, repoName } from "../helpers";
import { EmptyState, Input, Mono, PageHeader, Panel, Skeleton, StatusPill, Table, Tabs } from "../ui";
import styles from "./views.module.css";

type Filter = "all" | "live" | "review" | "merged" | "failed";
const filters: { id: Filter; label: string; statuses?: MissionStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Running", statuses: ["running", "queued"] },
  { id: "review", label: "Needs review", statuses: ["review"] },
  { id: "merged", label: "Merged", statuses: ["merged"] },
  { id: "failed", label: "Paused", statuses: ["failed", "cancelled"] },
];

export function MissionsView() {
  const s = useDemo();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const now = Date.now();

  const rows = useMemo(() => {
    if (!s) return [];
    const q = query.trim().toLowerCase();
    const statuses = filters.find((f) => f.id === filter)?.statuses;
    return s.missions
      .filter((m) => !statuses || statuses.includes(m.status))
      .filter(
        (m) => !q || `${m.title} ${m.id} ${repoName(s, m.repoId)} ${agentName(s, m.agentId)}`.toLowerCase().includes(q),
      )
      .sort((a, b) => lastUpdated(b) - lastUpdated(a));
  }, [s, filter, query]);

  if (!s) return <Skeleton rows={5} />;
  const counts = Object.fromEntries(
    filters.map((f) => [
      f.id,
      f.statuses ? s.missions.filter((m) => f.statuses?.includes(m.status)).length : s.missions.length,
    ]),
  );

  return (
    <>
      <PageHeader
        title="Missions"
        subtitle="Every task you handed to an agent, from prompt to merged PR."
        actions={
          <Button text="New mission" href="/dashboard/missions/new" newTab={false} variant="primary-md" showIcon />
        }
      />
      <Panel flush>
        <div className={styles.between} style={{ padding: "12px 20px 0" }}>
          <Tabs
            items={filters.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] }))}
            value={filter}
            onChange={setFilter}
          />
        </div>
        <div style={{ padding: "16px 20px" }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, id, repository or agent…"
            aria-label="Search missions"
          />
        </div>
        <Table
          columns={[
            { label: "Mission" },
            { label: "Repository" },
            { label: "Agent" },
            { label: "Status" },
            { label: "PR" },
            { label: "Cost", align: "right" },
            { label: "Updated", align: "right" },
          ]}
          rows={rows.map((m) => ({
            key: m.id,
            onClick: () => router.push(`/dashboard/missions/${m.id}`),
            cells: [
              <span key="t" className={styles.cellTitle}>
                <span className="t-small-strong wrap">{m.title}</span>
                <Mono subtle>{m.id}</Mono>
              </span>,
              <Mono key="r">{repoName(s, m.repoId)}</Mono>,
              <span key="a" className="t-small-strong pre">
                {agentName(s, m.agentId)}
              </span>,
              <StatusPill key="s" status={m.status} />,
              <Mono key="p" subtle={!m.pr}>
                {m.pr ? `#${m.pr.number}` : "—"}
              </Mono>,
              <Mono key="c">{money(m.cost)}</Mono>,
              <Mono key="u" subtle>
                {relative(lastUpdated(m), now)}
              </Mono>,
            ],
          }))}
          empty={
            <EmptyState
              command="$ shelra missions --filter"
              title="No missions match."
              body="Try another filter or start a new mission."
            />
          }
        />
      </Panel>
    </>
  );
}
