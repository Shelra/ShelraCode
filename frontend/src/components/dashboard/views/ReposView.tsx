"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { relative } from "@/lib/demo/format";
import { connectRepo, disconnectRepo, useDemo } from "@/lib/demo/store";
import {
  Chip,
  EmptyState,
  Modal,
  Mono,
  PageHeader,
  Panel,
  Skeleton,
  StatusPill,
  Table,
  TextButton,
  useToast,
} from "../ui";
import styles from "./views.module.css";

// What "GitHub" would list for the connected account.
const available = [
  { fullName: "acme/docs", language: "MDX", defaultBranch: "main" },
  { fullName: "acme/billing-service", language: "Go", defaultBranch: "main" },
  { fullName: "acme/design-system", language: "TypeScript", defaultBranch: "main" },
  { fullName: "acme/cli", language: "Rust", defaultBranch: "main" },
  { fullName: "acme/data-pipeline", language: "Python", defaultBranch: "develop" },
];

export function ReposView() {
  const s = useDemo();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!s) return <Skeleton rows={3} />;
  const now = Date.now();
  const connected = new Set(s.repos.map((r) => r.fullName));
  const github = s.integrations.find((i) => i.id === "github");

  return (
    <>
      <PageHeader
        title="Repositories"
        subtitle={
          github?.connected
            ? `Connected through GitHub · ${github.account}`
            : "Connect GitHub in Integrations to add repositories."
        }
        actions={
          <Button
            text="Connect repository"
            type="button"
            onClick={() => setOpen(true)}
            showIcon
            disabled={!github?.connected}
          />
        }
      />
      <Panel flush>
        <Table
          columns={[
            { label: "Repository" },
            { label: "Branch" },
            { label: "Language" },
            { label: "Missions", align: "right" },
            { label: "Last mission", align: "right" },
            { label: "Status" },
            { label: "" },
          ]}
          rows={s.repos.map((r) => {
            const missions = s.missions.filter((m) => m.repoId === r.id);
            const last = missions[0];
            return {
              key: r.id,
              cells: [
                <span key="n" className={styles.row}>
                  <span className="t-small-strong pre">{r.fullName}</span>
                  {r.private && <Chip muted>private</Chip>}
                </span>,
                <Mono key="b">{r.defaultBranch}</Mono>,
                <Mono key="l" subtle>
                  {r.language}
                </Mono>,
                <Mono key="m">{missions.length}</Mono>,
                <Mono key="t" subtle>
                  {last ? relative(last.createdAt, now) : "—"}
                </Mono>,
                <StatusPill key="s" status={r.status} />,
                <TextButton key="d" danger onClick={() => setConfirm(r.id)}>
                  Disconnect
                </TextButton>,
              ],
            };
          })}
          empty={
            <EmptyState
              command="$ shelra repos"
              title="No repositories connected."
              body="Connect one to give agents somewhere to work."
            />
          }
        />
      </Panel>

      <Modal open={open} title="Connect a repository" onClose={() => setOpen(false)}>
        <p className="t-body wrap">
          Repositories the GitHub app can see for {github?.account ?? "your account"}. ShelraCode asks for pull-request
          and checks access only.
        </p>
        <div className={styles.formStack}>
          {available.map((r) => {
            const done = connected.has(r.fullName);
            return (
              <div key={r.fullName} className={styles.between}>
                <span className={styles.cellTitle}>
                  <span className="t-small-strong pre">{r.fullName}</span>
                  <Mono subtle>
                    {r.language} · {r.defaultBranch}
                  </Mono>
                </span>
                {done ? (
                  <StatusPill status="connected" />
                ) : (
                  <Button
                    text="Connect"
                    variant="secondary-sm"
                    type="button"
                    onClick={() => {
                      connectRepo(r.fullName, r.language, r.defaultBranch);
                      toast(`Connecting ${r.fullName}…`);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={confirm !== null}
        title="Disconnect repository?"
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button text="Keep it" variant="secondary-md" type="button" onClick={() => setConfirm(null)} />
            <Button
              text="Disconnect"
              type="button"
              onClick={() => {
                if (confirm) disconnectRepo(confirm);
                setConfirm(null);
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">
          Running missions on it finish; new ones cannot start until it is connected again. Past missions stay in the
          history.
        </p>
      </Modal>
    </>
  );
}
