"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { stepTitles } from "@/lib/demo/seed";
import { createMission, useDemo } from "@/lib/demo/store";
import { type Autonomy, models } from "@/lib/demo/types";
import { Columns, Field, Input, PageHeader, Panel, Select, Skeleton, Textarea } from "../ui";
import styles from "./views.module.css";

export function NewMissionView() {
  const s = useDemo();
  const router = useRouter();
  const params = useSearchParams();
  const [prompt, setPrompt] = useState(params.get("prompt") ?? "");
  const [repoId, setRepoId] = useState(params.get("repo") ?? "");
  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy | "">("");
  const [maxCost, setMaxCost] = useState("");

  useEffect(() => {
    if (!s) return;
    if (!repoId) setRepoId(s.repos[0]?.id ?? "");
    if (!agentId) setAgentId(s.agents[0]?.id ?? "");
    if (!model) setModel(s.preferences.defaultModel);
    if (!autonomy) setAutonomy(s.preferences.defaultAutonomy);
    if (!maxCost) setMaxCost(String(s.preferences.maxCostPerMission));
  }, [s, repoId, agentId, model, autonomy, maxCost]);

  if (!s) return <Skeleton rows={4} />;
  const agent = s.agents.find((a) => a.id === agentId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length < 8) return;
    const id = createMission({ prompt, repoId, agentId, model, autonomy: autonomy || "review" });
    router.push(`/dashboard/missions/${id}`);
  };

  return (
    <>
      <PageHeader
        title="New mission"
        subtitle="Describe the task in plain English. ShelraCode plans, codes, tests and opens the PR."
      />
      <Columns ratio="3fr 2fr">
        <form onSubmit={submit}>
          <Panel title="MISSION">
            <div className={styles.formStack}>
              <Field label="Prompt" hint="Be specific about the outcome; the agent reads the codebase for the rest.">
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  placeholder="Fix the flaky auth token refresh. Add a regression test that fails before the fix and passes after."
                  required
                  minLength={8}
                />
              </Field>
              <div className={styles.formGrid}>
                <Field label="Repository">
                  <Select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
                    {s.repos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Agent" hint={agent?.description}>
                  <Select
                    value={agentId}
                    onChange={(e) => {
                      setAgentId(e.target.value);
                      const next = s.agents.find((a) => a.id === e.target.value);
                      if (next) {
                        setModel(next.model);
                        setAutonomy(next.autonomy);
                      }
                    }}
                  >
                    {s.agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.status === "paused"}>
                        {a.name}
                        {a.status === "paused" ? " (paused)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Model">
                  <Select value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((mo) => (
                      <option key={mo.id} value={mo.id}>
                        {mo.name} · {mo.note}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Max cost (USD)" hint="The mission pauses for review when it would exceed this.">
                  <Input type="number" min={1} step={1} value={maxCost} onChange={(e) => setMaxCost(e.target.value)} />
                </Field>
              </div>
              <Field label="Autonomy">
                <div className={styles.formGrid}>
                  {(
                    [
                      [
                        "review",
                        "Review before merge",
                        "The PR waits for a human. Recommended for anything user-facing.",
                      ],
                      [
                        "auto-merge",
                        "Auto-merge when green",
                        "Merges as soon as CI passes. Good for tests and dependency bumps.",
                      ],
                    ] as const
                  ).map(([value, label, help]) => (
                    <label key={value} className={`fb ${styles.radio} ${autonomy === value ? styles.radioOn : ""}`}>
                      <input
                        type="radio"
                        name="autonomy"
                        value={value}
                        checked={autonomy === value}
                        onChange={() => setAutonomy(value)}
                      />
                      <span className="t-small-strong pre">{label}</span>
                      <span className="t-body wrap">{help}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <div className={styles.row}>
                <Button text="Start mission" showIcon disabled={prompt.trim().length < 8} />
                <Button text="Cancel" href="/dashboard/missions" newTab={false} variant="secondary-md" />
              </div>
            </div>
          </Panel>
        </form>

        <div className={styles.stack}>
          <Panel title="WHAT HAPPENS NEXT">
            <div className={styles.steps}>
              {stepTitles.map((title, i) => (
                <div key={title} className={styles.step}>
                  <span className="t-small-mono pre" style={{ color: "var(--accent)" }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="t-small-strong pre">{title}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="TIPS">
            <div className={styles.formStack}>
              <p className="t-body wrap">Name the file or module when you know it — the agent skips the search.</p>
              <p className="t-body wrap">Ask for a regression test; the mission fails loudly instead of silently.</p>
              <p className="t-body wrap">Large refactors run better on DeepSeek V4 Flash with review before merge.</p>
            </div>
          </Panel>
        </div>
      </Columns>
    </>
  );
}
