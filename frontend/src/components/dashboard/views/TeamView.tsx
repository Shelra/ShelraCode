"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fullDate } from "@/lib/demo/format";
import { inviteMember, removeMember, updateMemberRole, useDemo } from "@/lib/demo/store";
import type { Role } from "@/lib/demo/types";
import {
  Avatar,
  Field,
  Grid,
  Input,
  Modal,
  Mono,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Stat,
  StatusPill,
  Table,
  TextButton,
  useToast,
} from "../ui";
import styles from "./views.module.css";

export function TeamView() {
  const s = useDemo();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [remove, setRemove] = useState<string | null>(null);
  if (!s) return <Skeleton rows={3} />;
  const active = s.members.filter((m) => m.status === "active");
  const invited = s.members.filter((m) => m.status === "invited");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const target = s.members.find((m) => m.id === remove);

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who can start missions, review PRs and change settings in this workspace."
        actions={<Button text="Invite member" type="button" showIcon onClick={() => setOpen(true)} />}
      />
      <Grid min={200}>
        <Stat
          label="Seats"
          value={`${active.length} / ${s.workspace.seats}`}
          progress={active.length / s.workspace.seats}
          hint="Add seats in Billing"
        />
        <Stat label="Pending invites" value={String(invited.length)} />
        <Stat label="Admins" value={String(s.members.filter((m) => m.role !== "member").length)} />
      </Grid>
      <Panel flush>
        <Table
          columns={[{ label: "Member" }, { label: "Role" }, { label: "Status" }, { label: "Joined" }, { label: "" }]}
          rows={s.members.map((m) => ({
            key: m.id,
            cells: [
              <span key="m" className={styles.row}>
                <Avatar name={m.name} size={32} />
                <span className={styles.cellTitle}>
                  <span className="t-small-strong pre">{m.name}</span>
                  <Mono subtle>{m.email}</Mono>
                </span>
              </span>,
              m.role === "owner" ? (
                <Mono key="r">owner</Mono>
              ) : (
                <span key="r" style={{ width: 140, display: "block" }}>
                  <Select
                    value={m.role}
                    onChange={(e) => updateMemberRole(m.id, e.target.value as Role)}
                    aria-label={`Role of ${m.name}`}
                  >
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </Select>
                </span>
              ),
              <StatusPill key="s" status={m.status} />,
              <Mono key="j" subtle>
                {m.status === "invited" ? `invited ${fullDate(m.joinedAt)}` : fullDate(m.joinedAt)}
              </Mono>,
              m.role === "owner" ? (
                <span key="x" />
              ) : (
                <TextButton key="d" danger onClick={() => setRemove(m.id)}>
                  {m.status === "invited" ? "Cancel invite" : "Remove"}
                </TextButton>
              ),
            ],
          }))}
        />
      </Panel>

      <Modal
        open={open}
        title="Invite a member"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button text="Cancel" variant="secondary-md" type="button" onClick={() => setOpen(false)} />
            <Button
              text="Send invite"
              type="button"
              disabled={!valid}
              onClick={() => {
                inviteMember(email.trim().toLowerCase(), role);
                setOpen(false);
                setEmail("");
                toast(`Invite sent to ${email.trim()}`);
              }}
            />
          </>
        }
      >
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@acme.dev"
          />
        </Field>
        <Field label="Role" hint="Admins manage billing, keys and members. Members run and review missions.">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </Select>
        </Field>
      </Modal>

      <Modal
        open={remove !== null}
        title={target?.status === "invited" ? "Cancel this invite?" : `Remove ${target?.name ?? "member"}?`}
        onClose={() => setRemove(null)}
        footer={
          <>
            <Button text="Keep" variant="secondary-md" type="button" onClick={() => setRemove(null)} />
            <Button
              text={target?.status === "invited" ? "Cancel invite" : "Remove"}
              type="button"
              onClick={() => {
                if (remove) removeMember(remove);
                setRemove(null);
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">They lose access immediately. Missions they started stay in the history.</p>
      </Modal>
    </>
  );
}
