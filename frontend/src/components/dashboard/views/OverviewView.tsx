"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { compact, money, relative } from "@/lib/demo/format";
import { approveMission, createMission, useDemo } from "@/lib/demo/store";
import { Bars } from "../charts";
import { agentName, creditsUsed, missionProgress, missionsSince, repoName } from "../helpers";
import { useIdentity } from "../identity";
import {
  Columns,
  EmptyState,
  Grid,
  Mono,
  PageHeader,
  Panel,
  ProgressBar,
  Select,
  Skeleton,
  Stat,
  StatusPill,
  Table,
  Textarea,
  TextButton,
} from "../ui";
import styles from "./views.module.css";

export function OverviewView() {
  const s = useDemo();
  const me = useIdentity();
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [repoId, setRepoId] = useState("");
  if (!s) return <Skeleton rows={4} />;

  const now = Date.now();
  const recent = missionsSince(s, 30, now);
  const previous = s.missions.filter(
    (m) => m.createdAt < now - 30 * 86_400_000 && m.createdAt >= now - 60 * 86_400_000,
  );
  const merged = recent.filter((m) => m.status === "merged").length;
  const live = s.missions.filter((m) => m.status === "running" || m.status === "queued");
  const review = s.missions.filter((m) => m.status === "review");
  const credits = creditsUsed(s);
  const included = s.workspace.creditsIncluded + s.workspace.creditsAddOn;
  const last14 = s.usage.slice(-14);
  const delta = previous.length ? Math.round(((recent.length - previous.length) / previous.length) * 100) : null;
  const firstName = me.name.split(" ")[0];

  const start = (e: FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length < 8) return;
    const id = createMission({
      prompt,
      repoId: repoId || s.repos[0].id,
      agentId: s.agents.find((a) => a.status !== "paused")?.id ?? s.agents[0].id,
      model: s.preferences.defaultModel,
      autonomy: s.preferences.defaultAutonomy,
    });
    router.push(`/dashboard/missions/${id}`);
  };

  return (
    <>
      <PageHeader
        title={`Good to see you, ${firstName}.`}
        subtitle={`${live.length} mission${live.length === 1 ? "" : "s"} in flight · ${review.length} waiting for your review · ${s.repos.length} repos connected`}
      />

      <form className={`fb ${styles.prompt}`} onSubmit={start}>
        <p className={`t-small-mono pre ${styles.promptLabel}`}>$ shelra</p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='"Fix the flaky auth token refresh and add a regression test"'
          rows={2}
          className={styles.promptInput}
          aria-label="Mission prompt"
        />
        <div className={styles.promptRow}>
          <div className={styles.promptRepo}>
            <Select value={repoId} onChange={(e) => setRepoId(e.target.value)} aria-label="Repository">
              {s.repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName}
                </option>
              ))}
            </Select>
          </div>
          <p className={`t-small-mono pre ${styles.promptHint}`}>
            {s.preferences.defaultAutonomy === "auto-merge" ? "auto-merge" : "review before merge"} ·{" "}
            {s.preferences.defaultModel}
          </p>
          <Button text="Start mission" showIcon disabled={prompt.trim().length < 8} />
        </div>
      </form>

      <Grid min={200}>
        <Stat
          label="Missions · 30 days"
          value={String(recent.length)}
          delta={delta === null ? undefined : `${delta >= 0 ? "+" : ""}${delta}%`}
          trend={delta === null ? undefined : delta >= 0 ? "up" : "down"}
          hint="vs the previous 30 days"
        />
        <Stat
          label="PRs merged"
          value={String(merged)}
          delta={`${recent.filter((m) => m.status === "review").length} in review`}
        />
        <Stat
          label="Hours recovered"
          value={`${Math.round(merged * 2.4)}h`}
          hint="≈ 2.4 engineer hours per merged PR"
        />
        <Stat
          label="Credits used"
          value={`${compact(credits)} / ${compact(included)}`}
          progress={credits / included}
          hint={`${Math.max(0, included - credits).toLocaleString("en-US")} left this cycle`}
        />
      </Grid>

      <Columns ratio="3fr 2fr">
        <div className={styles.stack}>
          <Panel title="LIVE" meta={`${live.length} running`} flush>
            {live.length === 0 ? (
              <EmptyState
                command="$ shelra status"
                title="No mission is running right now."
                body="Start one above or from any repository."
              />
            ) : (
              <div className={styles.liveList}>
                {live.map((m) => {
                  const last = m.log[m.log.length - 1];
                  const step = m.steps.find((st) => st.status === "active")?.title ?? "Queued";
                  return (
                    <a key={m.id} href={`/dashboard/missions/${m.id}`} className={styles.liveRow}>
                      <div className={styles.liveTop}>
                        <div className={styles.liveTitle}>
                          <StatusPill status={m.status} />
                          <span className="t-small-strong wrap">{m.title}</span>
                        </div>
                        <Mono subtle>
                          {repoName(s, m.repoId)} · {agentName(s, m.agentId)}
                        </Mono>
                      </div>
                      <ProgressBar value={missionProgress(m)} />
                      <div className={styles.liveBottom}>
                        <span className={`t-small-mono pre ${styles.liveStep}`}>{step}</span>
                        <span className={`t-body wrap ${styles.liveLog}`}>
                          {last?.text ?? "Waiting for a free slot…"}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title="RECENT MISSIONS"
            actions={<TextButton onClick={() => router.push("/dashboard/missions")}>View all →</TextButton>}
            flush
          >
            <Table
              columns={[
                { label: "Mission" },
                { label: "Repository" },
                { label: "Status" },
                { label: "Cost", align: "right" },
                { label: "Updated", align: "right" },
              ]}
              rows={s.missions.slice(0, 8).map((m) => ({
                key: m.id,
                href: `/dashboard/missions/${m.id}`,
                cells: [
                  <span key="t" className={styles.cellTitle}>
                    <span className="t-small-strong wrap">{m.title}</span>
                    <Mono subtle>{m.id}</Mono>
                  </span>,
                  <Mono key="r">{repoName(s, m.repoId)}</Mono>,
                  <StatusPill key="s" status={m.status} />,
                  <Mono key="c">{money(m.cost)}</Mono>,
                  <Mono key="u" subtle>
                    {relative(m.finishedAt ?? m.createdAt, now)}
                  </Mono>,
                ],
              }))}
            />
          </Panel>
        </div>

        <div className={styles.stack}>
          <Panel title="NEEDS REVIEW" meta={`${review.length}`} flush>
            {review.length === 0 ? (
              <EmptyState
                command="$ shelra review"
                title="Nothing waiting on you."
                body="PRs that need a human land here."
              />
            ) : (
              <div className={styles.reviewList}>
                {review.slice(0, 4).map((m) => (
                  <div key={m.id} className={styles.reviewRow}>
                    <a href={`/dashboard/missions/${m.id}`} className={styles.reviewText}>
                      <span className="t-small-strong wrap">{m.title}</span>
                      <Mono subtle>
                        PR #{m.pr?.number} · +{m.pr?.additions} −{m.pr?.deletions} · {repoName(s, m.repoId)}
                      </Mono>
                    </a>
                    <Button text="Merge" variant="secondary-sm" type="button" onClick={() => approveMission(m.id)} />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="USAGE · 14 DAYS"
            meta={money(last14.reduce((sum, d) => sum + d.cost, 0))}
            actions={<TextButton onClick={() => router.push("/dashboard/usage")}>Details →</TextButton>}
          >
            <Bars
              data={last14.map((d) => d.cost)}
              labels={last14.map((d) => d.date)}
              height={120}
              format={(v) => money(v)}
            />
            <div className={styles.legend}>
              <span className={`t-small-mono pre ${styles.legendItem}`}>
                {last14.reduce((sum, d) => sum + d.missions, 0)} missions
              </span>
              <span className={`t-small-mono pre ${styles.legendItem}`}>
                {compact(last14.reduce((sum, d) => sum + d.tokensIn + d.tokensOut, 0))} tokens
              </span>
            </div>
          </Panel>

          <Panel
            title="AGENTS"
            actions={<TextButton onClick={() => router.push("/dashboard/agents")}>Manage →</TextButton>}
            flush
          >
            <div className={styles.agentList}>
              {s.agents.map((a) => (
                <a key={a.id} href={`/dashboard/agents/${a.id}`} className={styles.agentRow}>
                  <span className="t-small-strong pre">{a.name}</span>
                  <Mono subtle>{s.missions.filter((m) => m.agentId === a.id).length} runs</Mono>
                  <StatusPill status={a.status} />
                </a>
              ))}
            </div>
          </Panel>
        </div>
      </Columns>
    </>
  );
}
