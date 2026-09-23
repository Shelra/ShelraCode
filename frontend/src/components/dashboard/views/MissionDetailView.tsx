"use client";

import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/Icons";
import { compact, duration, money, relative } from "@/lib/demo/format";
import { approveMission, cancelMission, retryMission, useDemo } from "@/lib/demo/store";
import { agentName, missionProgress, modelName, repoName } from "../helpers";
import { ExternalLinkIcon, FileIcon } from "../icons";
import { Terminal } from "../Terminal";
import { Columns, EmptyState, KeyValue, PageHeader, Panel, ProgressBar, Skeleton, StatusPill } from "../ui";
import styles from "./views.module.css";

export function MissionDetailView({ id }: { id: string }) {
  const s = useDemo();
  if (!s) return <Skeleton rows={4} />;
  const m = s.missions.find((mission) => mission.id === id);
  if (!m) {
    return (
      <Panel>
        <EmptyState
          command={`$ shelra missions show ${id}`}
          title="Mission not found."
          body="It may have been removed when the demo data was reset."
          action={<Button text="All missions" href="/dashboard/missions" newTab={false} variant="secondary-md" />}
        />
      </Panel>
    );
  }
  const live = m.status === "running" || m.status === "queued";
  const started = m.startedAt ?? m.createdAt;
  const elapsed = (m.finishedAt ?? Date.now()) - started;
  const showFiles = m.steps[2].status !== "pending";

  return (
    <>
      <PageHeader
        title={m.title}
        status={<StatusPill status={m.status} />}
        subtitle={`${repoName(s, m.repoId)} · ${agentName(s, m.agentId)} · ${modelName(m.model)} · started ${relative(started)}`}
        actions={
          <>
            {m.pr && <Button text={`PR #${m.pr.number}`} href={m.pr.url} variant="secondary-md" showIcon />}
            {live && <Button text="Cancel" variant="secondary-md" type="button" onClick={() => cancelMission(m.id)} />}
            {(m.status === "failed" || m.status === "cancelled") && (
              <Button text="Retry" variant="primary-md" type="button" onClick={() => retryMission(m.id)} />
            )}
            {m.status === "review" && (
              <Button
                text="Approve & merge"
                variant="primary-md"
                type="button"
                showIcon
                onClick={() => approveMission(m.id)}
              />
            )}
          </>
        }
      />

      <Columns ratio="3fr 2fr">
        <div className={styles.stack}>
          <Terminal lines={m.log} live={m.status === "running"} title={`shelra · ${m.id}`} height={420} />
          <Panel
            title="FILES CHANGED"
            meta={
              showFiles
                ? `${m.files.length} files · +${m.files.reduce((a, f) => a + f.additions, 0)} −${m.files.reduce((a, f) => a + f.deletions, 0)}`
                : "pending"
            }
            flush
          >
            {showFiles ? (
              <div className={styles.files}>
                {m.files.map((f) => (
                  <div key={f.path} className={styles.file}>
                    <span className={styles.filePath}>
                      <FileIcon size={14} color="var(--subtle)" />
                      <span className="t-small-mono pre">{f.path}</span>
                      {f.status === "added" && (
                        <span className="t-small-mono pre" style={{ color: "var(--accent)" }}>
                          new
                        </span>
                      )}
                    </span>
                    <span className={`t-small-mono pre ${styles.diff}`}>
                      <span className={styles.add}>+{f.additions}</span>
                      <span className={styles.del}>−{f.deletions}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                command="$ git diff --stat"
                title="No changes yet."
                body="Files appear once the agent starts writing code."
              />
            )}
          </Panel>
          <Panel title="PROMPT">
            <p className={`t-body wrap ${styles.promptText}`}>{m.prompt}</p>
          </Panel>
        </div>

        <div className={styles.stack}>
          <Panel title="PLAN" meta={`${m.steps.filter((st) => st.status === "done").length} of ${m.steps.length}`}>
            <div className={styles.steps}>
              <ProgressBar value={missionProgress(m)} warn={m.status === "failed"} />
              {m.steps.map((st, i) => (
                <div
                  key={st.id}
                  className={`${styles.step} ${st.status === "done" ? styles.stepDone : st.status === "active" ? styles.stepActive : st.status === "failed" ? styles.stepFailed : ""}`}
                >
                  <span className={styles.stepIcon}>
                    {st.status === "done" ? (
                      <CheckIcon size={16} strokeWidth={2} color="var(--accent)" />
                    ) : (
                      <span className={styles.stepDot} />
                    )}
                  </span>
                  <span className={`t-small-mono pre`} style={{ color: "var(--subtle)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={`t-small-strong pre ${styles.stepTitle}`}>{st.title}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="SUMMARY">
            <KeyValue
              rows={[
                { key: "status", value: <StatusPill status={m.status} /> },
                { key: "duration", value: duration(elapsed) },
                { key: "cost", value: money(m.cost) },
                { key: "tokens", value: `${compact(m.tokensIn)} in · ${compact(m.tokensOut)} out` },
                { key: "autonomy", value: m.autonomy === "auto-merge" ? "Auto-merge" : "Review before merge" },
                { key: "branch", value: m.pr ? <span className="t-small-mono pre">{m.pr.branch}</span> : "—" },
              ]}
            />
          </Panel>
          {m.pr && (
            <Panel
              title="PULL REQUEST"
              meta={`#${m.pr.number}`}
              actions={
                <a href={m.pr.url} target="_blank" rel="noopener" aria-label="Open on GitHub">
                  <ExternalLinkIcon size={16} color="var(--subtle)" />
                </a>
              }
            >
              <div className={styles.checks}>
                {m.pr.checks.map((c) => (
                  <div key={c.name} className={styles.between}>
                    <span className="t-small-mono pre">{c.name}</span>
                    <StatusPill status={c.status} />
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </Columns>
    </>
  );
}
