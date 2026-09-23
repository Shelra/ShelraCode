"use client";

import { Button } from "@/components/ui/Button";
import { fullDate } from "@/lib/demo/format";
import { toggleIntegration, useDemo } from "@/lib/demo/store";
import { Mono, PageHeader, Skeleton, StatusPill, useToast } from "../ui";
import styles from "./views.module.css";

const marks: Record<string, string> = { github: "GH", linear: "L", slack: "S", jira: "J", notion: "N" };

export function IntegrationsView() {
  const s = useDemo();
  const toast = useToast();
  if (!s) return <Skeleton rows={3} />;
  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="ShelraCode works inside the tools you already use: repos and PRs in GitHub, issues in Linear or Jira, alerts in Slack."
      />
      <div className={styles.cards}>
        {s.integrations.map((i) => (
          <div key={i.id} className={`fb ${styles.card}`}>
            <div className={styles.cardHead}>
              <div className={styles.row}>
                <span className={`${styles.mark} ${i.connected ? styles.markOn : ""}`}>{marks[i.id]}</span>
                <div className={styles.cardTitle}>
                  <span className="t-body-strong pre">{i.name}</span>
                  {i.connected && i.account && (
                    <Mono subtle>
                      {i.account} · since {i.connectedAt ? fullDate(i.connectedAt) : ""}
                    </Mono>
                  )}
                </div>
              </div>
              <StatusPill
                status={i.connected ? "connected" : "idle"}
                label={i.connected ? "Connected" : "Not connected"}
              />
            </div>
            <p className="t-body wrap">{i.description}</p>
            <div className={styles.cardFoot}>
              <Button
                text={i.connected ? "Disconnect" : "Connect"}
                variant={i.connected ? "secondary-sm" : "primary-sm"}
                type="button"
                onClick={() => {
                  toggleIntegration(i.id);
                  toast(i.connected ? `${i.name} disconnected` : `${i.name} connected (simulated OAuth)`);
                }}
              />
              {i.id === "github" && i.connected && (
                <a href="/dashboard/repos" className="t-small-strong pre" style={{ color: "var(--accent)" }}>
                  Manage repositories →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
