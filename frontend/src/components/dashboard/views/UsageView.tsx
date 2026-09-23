"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { compact, money, shortDate } from "@/lib/demo/format";
import { useDemo } from "@/lib/demo/store";
import { Bars, Ring } from "../charts";
import { agentName, creditsUsed, modelName } from "../helpers";
import { Columns, Grid, Mono, PageHeader, Panel, Skeleton, Stat, Table, Tabs } from "../ui";
import styles from "./views.module.css";

type Period = "7" | "30";

export function UsageView() {
  const s = useDemo();
  const [period, setPeriod] = useState<Period>("30");
  if (!s) return <Skeleton rows={4} />;
  const days = Number(period);
  const range = s.usage.slice(-days);
  const since = Date.now() - days * 86_400_000;
  const missions = s.missions.filter((m) => m.createdAt >= since && m.status !== "queued");
  const total = range.reduce((sum, d) => sum + d.cost, 0);
  const tokensIn = range.reduce((sum, d) => sum + d.tokensIn, 0);
  const tokensOut = range.reduce((sum, d) => sum + d.tokensOut, 0);
  const count = range.reduce((sum, d) => sum + d.missions, 0);
  const credits = creditsUsed(s);
  const included = s.workspace.creditsIncluded + s.workspace.creditsAddOn;

  const byModel = Object.values(
    missions.reduce<Record<string, { model: string; missions: number; tokens: number; cost: number }>>((acc, m) => {
      if (!acc[m.model]) acc[m.model] = { model: m.model, missions: 0, tokens: 0, cost: 0 };
      const row = acc[m.model];
      row.missions += 1;
      row.tokens += m.tokensIn + m.tokensOut;
      row.cost += m.cost;
      return acc;
    }, {}),
  ).sort((a, b) => b.cost - a.cost);
  const byAgent = Object.values(
    missions.reduce<Record<string, { agentId: string; missions: number; cost: number; merged: number }>>((acc, m) => {
      if (!acc[m.agentId]) acc[m.agentId] = { agentId: m.agentId, missions: 0, cost: 0, merged: 0 };
      const row = acc[m.agentId];
      row.missions += 1;
      row.cost += m.cost;
      if (m.status === "merged") row.merged += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.cost - a.cost);
  const modelTotal = Math.max(
    0.01,
    byModel.reduce((sum, r) => sum + r.cost, 0),
  );

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="What the agents consumed, by day, model and agent. One credit is a cent of model spend."
        actions={
          <Tabs
            items={[
              { id: "7", label: "7 days" },
              { id: "30", label: "30 days" },
            ]}
            value={period}
            onChange={setPeriod}
          />
        }
      />
      <Grid min={200}>
        <Stat label="Missions" value={String(count)} hint={`${(count / days).toFixed(1)} per day`} />
        <Stat label="Tokens in" value={compact(tokensIn)} hint="prompt + context" />
        <Stat label="Tokens out" value={compact(tokensOut)} hint="code + reasoning" />
        <Stat label="Spend" value={money(total)} hint={count ? `${money(total / count)} per mission` : undefined} />
      </Grid>
      <Panel title="SPEND PER DAY" meta={money(total)}>
        <Bars data={range.map((d) => d.cost)} labels={range.map((d) => d.date)} height={180} format={(v) => money(v)} />
        <div className={styles.between} style={{ marginTop: 10 }}>
          <Mono subtle>{shortDate(new Date(`${range[0]?.date}T12:00:00`).getTime())}</Mono>
          <Mono subtle>today</Mono>
        </div>
      </Panel>
      <Columns ratio="1fr 1fr">
        <Panel title="BY MODEL" flush>
          <Table
            columns={[
              { label: "Model" },
              { label: "Missions", align: "right" },
              { label: "Tokens", align: "right" },
              { label: "Cost", align: "right" },
              { label: "Share" },
            ]}
            rows={byModel.map((r) => ({
              key: r.model,
              cells: [
                <span key="m" className="t-small-strong pre">
                  {modelName(r.model)}
                </span>,
                <Mono key="n">{r.missions}</Mono>,
                <Mono key="t">{compact(r.tokens)}</Mono>,
                <Mono key="c">{money(r.cost)}</Mono>,
                <span key="s" className={styles.share}>
                  <span className={styles.shareBar}>
                    <span className={styles.shareFill} style={{ width: `${(r.cost / modelTotal) * 100}%` }} />
                  </span>
                  <Mono subtle>{Math.round((r.cost / modelTotal) * 100)}%</Mono>
                </span>,
              ],
            }))}
          />
        </Panel>
        <Panel title="BY AGENT" flush>
          <Table
            columns={[
              { label: "Agent" },
              { label: "Missions", align: "right" },
              { label: "Merged", align: "right" },
              { label: "Cost", align: "right" },
            ]}
            rows={byAgent.map((r) => ({
              key: r.agentId,
              href: `/dashboard/agents/${r.agentId}`,
              cells: [
                <span key="a" className="t-small-strong pre">
                  {agentName(s, r.agentId)}
                </span>,
                <Mono key="n">{r.missions}</Mono>,
                <Mono key="m">{r.merged}</Mono>,
                <Mono key="c">{money(r.cost)}</Mono>,
              ],
            }))}
          />
        </Panel>
      </Columns>
      <Panel
        title="PLAN QUOTA"
        meta={`${s.workspace.plan} plan`}
        actions={<Button text="Buy credits" href="/dashboard/billing" newTab={false} variant="secondary-sm" />}
      >
        <div className={styles.ringRow}>
          <Ring value={credits / included} label="Credits used" />
          <div className={styles.stack}>
            <p className="t-body-strong wrap">
              {credits.toLocaleString("en-US")} of {included.toLocaleString("en-US")} credits used this cycle
            </p>
            <p className="t-body wrap">
              {s.workspace.creditsIncluded.toLocaleString("en-US")} included in{" "}
              {s.workspace.plan === "pro" ? "Pro" : s.workspace.plan} ·{" "}
              {s.workspace.creditsAddOn.toLocaleString("en-US")} add-on · resets on the 1st
            </p>
          </div>
        </div>
      </Panel>
    </>
  );
}
