"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fullDate, relative } from "@/lib/demo/format";
import { createApiKey, revokeApiKey, useDemo } from "@/lib/demo/store";
import { CopyIcon } from "../icons";
import {
  Checkbox,
  Chip,
  Field,
  IconButton,
  Input,
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

const allScopes = ["missions:read", "missions:write", "repos:read", "usage:read", "agents:write"];

export function ApiKeysView() {
  const s = useDemo();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["missions:read", "missions:write"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<string | null>(null);
  if (!s) return <Skeleton rows={3} />;
  const now = Date.now();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Copy failed — select the text instead");
    }
  };

  return (
    <>
      <PageHeader
        title="API keys"
        subtitle="Start missions from CI, scripts or the CLI. Keys inherit the workspace's spend limit."
        actions={
          <Button
            text="Create key"
            type="button"
            showIcon
            onClick={() => {
              setName("");
              setSecret(null);
              setOpen(true);
            }}
          />
        }
      />
      <Panel flush>
        <Table
          columns={[
            { label: "Name" },
            { label: "Key" },
            { label: "Scopes" },
            { label: "Created" },
            { label: "Last used" },
            { label: "Status" },
            { label: "" },
          ]}
          rows={s.apiKeys.map((k) => ({
            key: k.id,
            cells: [
              <span key="n" className="t-small-strong pre">
                {k.name}
              </span>,
              <Mono key="p">{k.prefix}••••••••</Mono>,
              <span key="s" className={styles.chips}>
                {k.scopes.map((sc) => (
                  <Chip key={sc} muted>
                    {sc}
                  </Chip>
                ))}
              </span>,
              <Mono key="c" subtle>
                {fullDate(k.createdAt)}
              </Mono>,
              <Mono key="u" subtle>
                {k.lastUsedAt ? relative(k.lastUsedAt, now) : "never"}
              </Mono>,
              <StatusPill key="st" status={k.revokedAt ? "revoked" : "active"} />,
              k.revokedAt ? (
                <span key="x" />
              ) : (
                <TextButton key="r" danger onClick={() => setRevoke(k.id)}>
                  Revoke
                </TextButton>
              ),
            ],
          }))}
        />
      </Panel>
      <Panel title="USING A KEY">
        <p className={`t-small-mono wrap ${styles.code}`}>
          {`curl https://api.shelra.dev/v1/missions \\\n  -H "Authorization: Bearer $SHELRA_KEY" \\\n  -d '{"repo":"acme/api","prompt":"Fix the flaky auth token refresh"}'`}
        </p>
      </Panel>

      <Modal
        open={open}
        title={secret ? "Your new key" : "Create API key"}
        onClose={() => setOpen(false)}
        footer={
          secret ? (
            <Button text="Done" type="button" onClick={() => setOpen(false)} />
          ) : (
            <>
              <Button text="Cancel" variant="secondary-md" type="button" onClick={() => setOpen(false)} />
              <Button
                text="Create key"
                type="button"
                disabled={!name.trim() || scopes.length === 0}
                onClick={() => setSecret(createApiKey(name.trim(), scopes))}
              />
            </>
          )
        }
      >
        {secret ? (
          <>
            <p className="t-body wrap">
              Copy it now — it is shown only once. Store it in your CI secrets or your shell profile.
            </p>
            <div className={styles.secret}>
              <span className={`t-small-mono ${styles.secretText}`}>{secret}</span>
              <IconButton label="Copy key" onClick={() => copy(secret)}>
                <CopyIcon size={16} color="var(--default)" />
              </IconButton>
            </div>
          </>
        ) : (
          <>
            <Field label="Name" hint="Where the key will live, so you recognise it later.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI (GitHub Actions)" />
            </Field>
            <Field label="Scopes">
              <div className={styles.formStack}>
                {allScopes.map((sc) => (
                  <Checkbox
                    key={sc}
                    label={sc}
                    checked={scopes.includes(sc)}
                    onChange={(on) => setScopes((list) => (on ? [...list, sc] : list.filter((x) => x !== sc)))}
                  />
                ))}
              </div>
            </Field>
          </>
        )}
      </Modal>

      <Modal
        open={revoke !== null}
        title="Revoke this key?"
        onClose={() => setRevoke(null)}
        footer={
          <>
            <Button text="Keep it" variant="secondary-md" type="button" onClick={() => setRevoke(null)} />
            <Button
              text="Revoke"
              type="button"
              onClick={() => {
                if (revoke) revokeApiKey(revoke);
                setRevoke(null);
                toast("Key revoked");
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">Requests with it fail immediately. Missions it already started keep running.</p>
      </Modal>
    </>
  );
}
