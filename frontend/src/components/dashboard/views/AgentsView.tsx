"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { money, percent, relative } from "@/lib/demo/format";
import { createAgent, deleteAgent, toggleAgentPaused, updateAgent, useDemo } from "@/lib/demo/store";
import { type Autonomy, models, type Trigger } from "@/lib/demo/types";
import { modelName, repoName, successRate } from "../helpers";
import {
  Checkbox,
  Chip,
  Columns,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Modal,
  Mono,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  StatusPill,
  Table,
  Textarea,
  TextButton,
} from "../ui";
import styles from "./views.module.css";

const triggerLabels: Record<Trigger, string> = {
  manual: "Manual",
  issue: "Issue",
  schedule: "Schedule",
  "pr-comment": "PR comment",
};
const templates = [
  {
    id: "bug",
    name: "Bug fixer",
    description: "Takes an issue, finds the root cause, patches it and adds the regression test.",
    model: "qwen3-coder-30b",
    autonomy: "review" as Autonomy,
    triggers: ["manual", "issue"] as Trigger[],
  },
  {
    id: "feature",
    name: "Feature builder",
    description: "Turns a spec into a full-stack implementation with edge cases and tests.",
    model: "deepseek-v4-flash",
    autonomy: "review" as Autonomy,
    triggers: ["manual"] as Trigger[],
  },
  {
    id: "tests",
    name: "Test writer",
    description: "Generates unit and integration suites for a module and fixes what fails.",
    model: "nemotron-3-ultra-free",
    autonomy: "auto-merge" as Autonomy,
    triggers: ["manual", "pr-comment"] as Trigger[],
  },
  {
    id: "custom",
    name: "Custom",
    description: "",
    model: "qwen3-coder-30b",
    autonomy: "review" as Autonomy,
    triggers: ["manual"] as Trigger[],
  },
];

export function AgentsView() {
  const s = useDemo();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState("bug");
  const [name, setName] = useState("Bug fixer");
  const [description, setDescription] = useState(templates[0].description);
  const [model, setModel] = useState(templates[0].model);
  const [autonomy, setAutonomy] = useState<Autonomy>("review");
  const [triggers, setTriggers] = useState<Trigger[]>(["manual", "issue"]);
  if (!s) return <Skeleton rows={3} />;

  const pickTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id) ?? templates[3];
    setTemplate(id);
    setName(t.name === "Custom" ? "" : t.name);
    setDescription(t.description);
    setModel(t.model);
    setAutonomy(t.autonomy);
    setTriggers(t.triggers);
  };
  const create = () => {
    if (!name.trim()) return;
    createAgent({ name: name.trim(), description: description.trim(), model, autonomy, triggers });
    setOpen(false);
  };

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Reusable configurations: what a mission is allowed to do, with which model, and what triggers it."
        actions={<Button text="New agent" type="button" onClick={() => setOpen(true)} showIcon />}
      />
      <div className={styles.cards}>
        {s.agents.map((a) => {
          const runs = s.missions.filter((m) => m.agentId === a.id);
          const rate = successRate(runs);
          const avg = runs.length ? runs.reduce((sum, m) => sum + m.cost, 0) / runs.length : 0;
          return (
            <div key={a.id} className={`fb ${styles.card}`}>
              <div className={styles.cardHead}>
                <div className={styles.cardTitle}>
                  <a
                    href={`/dashboard/agents/${a.id}`}
                    className="t-body-strong wrap"
                    style={{ color: "var(--default)" }}
                  >
                    {a.name}
                  </a>
                  <Mono subtle>
                    {modelName(a.model)} · {a.autonomy === "auto-merge" ? "auto-merge" : "review"}
                  </Mono>
                </div>
                <StatusPill status={a.status} />
              </div>
              <p className="t-body wrap">{a.description}</p>
              <div className={styles.chips}>
                {a.triggers.map((t) => (
                  <Chip key={t} muted>
                    {triggerLabels[t]}
                  </Chip>
                ))}
              </div>
              <div className={styles.cardStats}>
                <div className={styles.cardStat}>
                  <span className={`t-small-mono pre ${styles.cardStatLabel}`}>runs</span>
                  <span className={styles.cardStatValue}>{runs.length}</span>
                </div>
                <div className={styles.cardStat}>
                  <span className={`t-small-mono pre ${styles.cardStatLabel}`}>success</span>
                  <span className={styles.cardStatValue}>{rate === null ? "—" : percent(rate)}</span>
                </div>
                <div className={styles.cardStat}>
                  <span className={`t-small-mono pre ${styles.cardStatLabel}`}>avg cost</span>
                  <span className={styles.cardStatValue}>{money(avg)}</span>
                </div>
              </div>
              <div className={styles.cardFoot}>
                <Button text="Open" href={`/dashboard/agents/${a.id}`} newTab={false} variant="secondary-sm" />
                <TextButton onClick={() => toggleAgentPaused(a.id)}>
                  {a.status === "paused" ? "Resume" : "Pause"}
                </TextButton>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={open}
        title="New agent"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button text="Cancel" variant="secondary-md" type="button" onClick={() => setOpen(false)} />
            <Button text="Create agent" type="button" onClick={create} disabled={!name.trim()} />
          </>
        }
      >
        <Field label="Template">
          <Select value={template} onChange={(e) => pickTemplate(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Release notes writer" />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What this agent is for and how it should behave."
          />
        </Field>
        <div className={styles.formGrid}>
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((mo) => (
                <option key={mo.id} value={mo.id}>
                  {mo.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Autonomy">
            <Select value={autonomy} onChange={(e) => setAutonomy(e.target.value as Autonomy)}>
              <option value="review">Review before merge</option>
              <option value="auto-merge">Auto-merge when green</option>
            </Select>
          </Field>
        </div>
        <Field label="Triggers">
          <div className={styles.formStack}>
            {(Object.keys(triggerLabels) as Trigger[]).map((t) => (
              <Checkbox
                key={t}
                label={triggerLabels[t]}
                checked={triggers.includes(t)}
                onChange={(on) => setTriggers((list) => (on ? [...list, t] : list.filter((x) => x !== t)))}
              />
            ))}
          </div>
        </Field>
      </Modal>
    </>
  );
}

export function AgentDetailView({ id }: { id: string }) {
  const s = useDemo();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  if (!s) return <Skeleton rows={3} />;
  const a = s.agents.find((agent) => agent.id === id);
  if (!a) {
    return (
      <Panel>
        <EmptyState
          command={`$ shelra agents show ${id}`}
          title="Agent not found."
          action={<Button text="All agents" href="/dashboard/agents" newTab={false} variant="secondary-md" />}
        />
      </Panel>
    );
  }
  const runs = s.missions.filter((m) => m.agentId === a.id);
  const rate = successRate(runs);
  const now = Date.now();

  return (
    <>
      <PageHeader
        title={a.name}
        status={<StatusPill status={a.status} />}
        subtitle={a.description}
        actions={
          <>
            <Button
              text="Run a mission"
              href={`/dashboard/missions/new`}
              newTab={false}
              variant="primary-md"
              showIcon
            />
            <Button
              text={a.status === "paused" ? "Resume" : "Pause"}
              variant="secondary-md"
              type="button"
              onClick={() => toggleAgentPaused(a.id)}
            />
          </>
        }
      />
      <Columns ratio="3fr 2fr">
        <Panel title="RUNS" meta={`${runs.length} missions`} flush>
          <Table
            columns={[
              { label: "Mission" },
              { label: "Repository" },
              { label: "Status" },
              { label: "Cost", align: "right" },
              { label: "When", align: "right" },
            ]}
            rows={runs.map((m) => ({
              key: m.id,
              onClick: () => router.push(`/dashboard/missions/${m.id}`),
              cells: [
                <span key="t" className="t-small-strong wrap">
                  {m.title}
                </span>,
                <Mono key="r">{repoName(s, m.repoId)}</Mono>,
                <StatusPill key="s" status={m.status} />,
                <Mono key="c">{money(m.cost)}</Mono>,
                <Mono key="w" subtle>
                  {relative(m.finishedAt ?? m.createdAt, now)}
                </Mono>,
              ],
            }))}
            empty={<EmptyState command="$ shelras" title="This agent has not run yet." />}
          />
        </Panel>
        <div className={styles.stack}>
          <Panel title="CONFIGURATION">
            <div className={styles.formStack}>
              <Field label="Model">
                <Select value={a.model} onChange={(e) => updateAgent(a.id, { model: e.target.value })}>
                  {models.map((mo) => (
                    <option key={mo.id} value={mo.id}>
                      {mo.name} · {mo.note}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Autonomy">
                <Select
                  value={a.autonomy}
                  onChange={(e) => updateAgent(a.id, { autonomy: e.target.value as Autonomy })}
                >
                  <option value="review">Review before merge</option>
                  <option value="auto-merge">Auto-merge when green</option>
                </Select>
              </Field>
              <Field label="Triggers">
                <div className={styles.formStack}>
                  {(Object.keys(triggerLabels) as Trigger[]).map((t) => (
                    <Checkbox
                      key={t}
                      label={triggerLabels[t]}
                      checked={a.triggers.includes(t)}
                      onChange={(on) =>
                        updateAgent(a.id, { triggers: on ? [...a.triggers, t] : a.triggers.filter((x) => x !== t) })
                      }
                    />
                  ))}
                </div>
              </Field>
            </div>
          </Panel>
          <Panel title="STATS">
            <KeyValue
              rows={[
                { key: "runs", value: String(runs.length) },
                { key: "success rate", value: rate === null ? "—" : percent(rate) },
                { key: "total cost", value: money(runs.reduce((sum, m) => sum + m.cost, 0)) },
                { key: "created", value: relative(a.createdAt, now) },
              ]}
            />
          </Panel>
          <Panel title="DANGER ZONE" className={styles.dangerZone}>
            <div className={styles.between}>
              <p className="t-body wrap">Deleting keeps its past missions.</p>
              <TextButton danger onClick={() => setConfirm(true)}>
                Delete agent
              </TextButton>
            </div>
          </Panel>
        </div>
      </Columns>
      <Modal
        open={confirm}
        title={`Delete ${a.name}?`}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button text="Keep it" variant="secondary-md" type="button" onClick={() => setConfirm(false)} />
            <Button
              text="Delete"
              type="button"
              onClick={() => {
                deleteAgent(a.id);
                router.push("/dashboard/agents");
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">
          Missions already run by this agent stay in the history. Scheduled triggers stop immediately.
        </p>
      </Modal>
    </>
  );
}
