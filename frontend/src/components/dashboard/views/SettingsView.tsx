"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { resetDemo, updatePreferences, updateWorkspace, useDemo } from "@/lib/demo/store";
import { type Autonomy, models } from "@/lib/demo/types";
import { useIdentity } from "../identity";
import {
  Avatar,
  Checkbox,
  Columns,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  TextButton,
  useToast,
} from "../ui";
import styles from "./views.module.css";

export function SettingsView() {
  const s = useDemo();
  const me = useIdentity();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  if (!s) return <Skeleton rows={4} />;
  const w = s.workspace;
  const p = s.preferences;
  const dirty = (name !== null && name !== w.name) || (slug !== null && slug !== w.slug);

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your profile, the workspace and the defaults every new mission starts with."
      />
      <Columns ratio="1fr 1fr">
        <div className={styles.stack}>
          <Panel title="PROFILE">
            <div className={styles.row}>
              <Avatar name={me.name} image={me.image} size={48} />
              <div className={styles.cellTitle}>
                <span className="t-body-strong wrap">{me.name}</span>
                <span className="t-body wrap">
                  {me.signedIn ? me.email : "Demo workspace · sign in to use your own profile"}
                </span>
              </div>
            </div>
            <p className="t-small-mono wrap" style={{ color: "var(--subtle)", marginTop: 16 }}>
              {me.signedIn
                ? "Name and photo come from your sign-in provider."
                : "Signed-in users see their GitHub, Google or email identity here."}
            </p>
          </Panel>
          <Panel title="WORKSPACE">
            <div className={styles.formStack}>
              <Field label="Name">
                <Input value={name ?? w.name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Slug" hint="Used in URLs and the CLI: shelra --workspace <slug>">
                <Input
                  value={slug ?? w.slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                />
              </Field>
              <div className={styles.row}>
                <Button
                  text="Save workspace"
                  variant="secondary-md"
                  type="button"
                  disabled={!dirty}
                  onClick={() => {
                    updateWorkspace({ name: (name ?? w.name).trim() || w.name, slug: (slug ?? w.slug) || w.slug });
                    setName(null);
                    setSlug(null);
                    toast("Workspace saved");
                  }}
                />
              </div>
            </div>
          </Panel>
        </div>
        <div className={styles.stack}>
          <Panel title="MISSION DEFAULTS">
            <div className={styles.formStack}>
              <Field label="Default model">
                <Select value={p.defaultModel} onChange={(e) => updatePreferences({ defaultModel: e.target.value })}>
                  {models.map((mo) => (
                    <option key={mo.id} value={mo.id}>
                      {mo.name} · {mo.note}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Default autonomy">
                <Select
                  value={p.defaultAutonomy}
                  onChange={(e) => updatePreferences({ defaultAutonomy: e.target.value as Autonomy })}
                >
                  <option value="review">Review before merge</option>
                  <option value="auto-merge">Auto-merge when green</option>
                </Select>
              </Field>
              <Field label="Max cost per mission (USD)">
                <Input
                  type="number"
                  min={1}
                  value={p.maxCostPerMission}
                  onChange={(e) => updatePreferences({ maxCostPerMission: Number(e.target.value) || 1 })}
                />
              </Field>
            </div>
          </Panel>
          <Panel title="NOTIFICATIONS">
            <div className={styles.formStack}>
              <Checkbox
                label="When a PR is ready for review"
                checked={p.notifyOnReview}
                onChange={(on) => updatePreferences({ notifyOnReview: on })}
              />
              <Checkbox
                label="When a mission pauses or fails"
                checked={p.notifyOnFailure}
                onChange={(on) => updatePreferences({ notifyOnFailure: on })}
              />
              <Checkbox
                label="Weekly digest by email"
                checked={p.weeklyDigest}
                onChange={(on) => updatePreferences({ weeklyDigest: on })}
              />
            </div>
          </Panel>
          <Panel title="DANGER ZONE" className={styles.dangerZone}>
            <div className={styles.formStack}>
              <div className={styles.between}>
                <p className="t-body wrap">Reset the demo data to its initial state.</p>
                <TextButton onClick={() => setConfirm("reset")}>Reset demo data</TextButton>
              </div>
              <div className={styles.between}>
                <p className="t-body wrap">Delete the workspace and everything in it.</p>
                <TextButton danger onClick={() => setConfirm("delete")}>
                  Delete workspace
                </TextButton>
              </div>
            </div>
          </Panel>
        </div>
      </Columns>
      <Modal
        open={confirm !== null}
        title={confirm === "reset" ? "Reset demo data?" : "Delete workspace?"}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button text="Cancel" variant="secondary-md" type="button" onClick={() => setConfirm(null)} />
            <Button
              text={confirm === "reset" ? "Reset" : "Delete"}
              type="button"
              onClick={() => {
                if (confirm === "reset") {
                  resetDemo();
                  toast("Demo data reset");
                } else {
                  toast("Workspace deletion is simulated in the demo");
                }
                setConfirm(null);
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">
          {confirm === "reset"
            ? "Missions, keys, members and settings go back to the seeded workspace."
            : "This cannot be undone. Members lose access and running missions are cancelled."}
        </p>
      </Modal>
    </>
  );
}
