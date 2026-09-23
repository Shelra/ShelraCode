"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { fullDate, money } from "@/lib/demo/format";
import { buyCredits, changePlan, updateWorkspace, useDemo } from "@/lib/demo/store";
import { type Plan, planLimits } from "@/lib/demo/types";
import { creditsUsed } from "../helpers";
import { DownloadIcon } from "../icons";
import {
  Columns,
  Field,
  IconButton,
  Input,
  KeyValue,
  Modal,
  Mono,
  PageHeader,
  Panel,
  ProgressBar,
  Skeleton,
  StatusPill,
  Table,
  useToast,
} from "../ui";
import styles from "./views.module.css";

const packs = [
  { credits: 625, price: 25 },
  { credits: 1250, price: 45 },
  { credits: 2500, price: 80 },
];

export function BillingView() {
  const s = useDemo();
  const toast = useToast();
  const [planModal, setPlanModal] = useState(false);
  const [creditsModal, setCreditsModal] = useState(false);
  const [pack, setPack] = useState(1);
  const [limit, setLimit] = useState<string | null>(null);
  if (!s) return <Skeleton rows={4} />;
  const w = s.workspace;
  const plan = planLimits[w.plan];
  const credits = creditsUsed(s);
  const included = w.creditsIncluded + w.creditsAddOn;
  const monthly = w.plan === "pro" ? (w.yearly ? 23 : 29) * w.seats : 0;
  const next = new Date();
  next.setMonth(next.getMonth() + 1, 1);

  return (
    <>
      <PageHeader title="Billing" subtitle="Plan, credits, payment method and invoices." />
      <Columns ratio="1fr 1fr">
        <Panel
          title="PLAN"
          meta={plan.name}
          actions={
            <Button text="Change plan" variant="secondary-sm" type="button" onClick={() => setPlanModal(true)} />
          }
        >
          <KeyValue
            rows={[
              {
                key: "price",
                value:
                  w.plan === "enterprise"
                    ? "Custom"
                    : `${money(monthly, 0)} / month${w.yearly ? " · billed yearly" : ""}`,
              },
              { key: "seats", value: `${s.members.filter((m) => m.status === "active").length} of ${w.seats} used` },
              { key: "missions", value: Number.isFinite(plan.missions) ? `${plan.missions} / month` : "Unlimited" },
              { key: "repos", value: Number.isFinite(plan.repos) ? `up to ${plan.repos}` : "Unlimited" },
              { key: "next invoice", value: fullDate(next.getTime()) },
            ]}
          />
        </Panel>
        <Panel
          title="CREDITS"
          meta={`${credits.toLocaleString("en-US")} / ${included.toLocaleString("en-US")}`}
          actions={
            <Button text="Buy credits" variant="primary-sm" type="button" onClick={() => setCreditsModal(true)} />
          }
        >
          <div className={styles.stack}>
            <ProgressBar value={credits / included} warn={credits / included > 0.85} />
            <KeyValue
              rows={[
                { key: "included", value: w.creditsIncluded.toLocaleString("en-US") },
                { key: "add-on", value: w.creditsAddOn.toLocaleString("en-US") },
                { key: "used this cycle", value: credits.toLocaleString("en-US") },
                { key: "overage", value: "$0.04 per credit · off" },
              ]}
            />
          </div>
        </Panel>
      </Columns>
      <Columns ratio="1fr 1fr">
        <Panel title="SPEND LIMIT">
          <div className={styles.formStack}>
            <p className="t-body wrap">Missions pause for review once the workspace spends this much in a month.</p>
            <Field label="Monthly limit (USD)">
              <Input
                type="number"
                min={0}
                value={limit ?? String(w.spendLimit)}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <div className={styles.row}>
              <Button
                text="Save limit"
                variant="secondary-md"
                type="button"
                disabled={limit === null || Number(limit) === w.spendLimit}
                onClick={() => {
                  updateWorkspace({ spendLimit: Number(limit) });
                  setLimit(null);
                  toast("Spend limit saved");
                }}
              />
            </div>
          </div>
        </Panel>
        <Panel
          title="PAYMENT METHOD"
          actions={
            <Button
              text="Update"
              variant="secondary-sm"
              type="button"
              onClick={() => toast("Card updates are simulated in the demo")}
            />
          }
        >
          <KeyValue
            rows={[
              {
                key: "card",
                value: w.paymentMethod ? `${w.paymentMethod.brand} •••• ${w.paymentMethod.last4}` : "None",
              },
              { key: "expires", value: w.paymentMethod?.expires ?? "—" },
              { key: "billing email", value: s.members.find((m) => m.role === "owner")?.email ?? "—" },
            ]}
          />
        </Panel>
      </Columns>
      <Panel title="INVOICES" flush>
        <Table
          columns={[
            { label: "Invoice" },
            { label: "Date" },
            { label: "Description" },
            { label: "Amount", align: "right" },
            { label: "Status" },
            { label: "" },
          ]}
          rows={s.invoices.map((inv) => ({
            key: inv.id,
            cells: [
              <Mono key="i">{inv.id}</Mono>,
              <Mono key="d" subtle>
                {fullDate(inv.date)}
              </Mono>,
              <span key="x" className="t-small-strong wrap">
                {inv.description}
              </span>,
              <Mono key="a">{money(inv.amount, 0)}</Mono>,
              <StatusPill key="s" status={inv.status} />,
              <IconButton key="dl" label="Download PDF" onClick={() => toast(`${inv.id}.pdf (simulated)`)}>
                <DownloadIcon size={16} color="var(--default)" />
              </IconButton>,
            ],
          }))}
        />
      </Panel>

      <Modal open={planModal} title="Change plan" onClose={() => setPlanModal(false)}>
        <div className={styles.between}>
          <p className="t-body wrap">Billing cycle</p>
          <div className={styles.row}>
            <span className="t-small-strong pre">Monthly</span>
            <Toggle on={w.yearly} onToggle={() => changePlan(w.plan, !w.yearly)} />
            <span className="t-small-strong pre">Yearly · 20% off</span>
          </div>
        </div>
        <div className={styles.formStack}>
          {(Object.keys(planLimits) as Plan[]).map((id) => {
            const p = planLimits[id];
            const price = id === "pro" ? (w.yearly ? 23 : 29) : p.price;
            return (
              <button
                key={id}
                type="button"
                className={`fb ${styles.card} ${w.plan === id ? styles.cardSelected : ""}`}
                onClick={() => {
                  changePlan(id, w.yearly);
                  toast(`Plan changed to ${p.name}`);
                }}
                style={{ cursor: "pointer", textAlign: "left" }}
              >
                <div className={styles.cardHead}>
                  <span className="t-body-strong pre">{p.name}</span>
                  <span className={styles.cardStatValue}>
                    {id === "enterprise" ? "Custom" : `${money(price, 0)}/mo`}
                  </span>
                </div>
                <p className="t-body wrap">
                  {Number.isFinite(p.missions) ? `${p.missions} missions / month` : "Unlimited missions"} ·{" "}
                  {Number.isFinite(p.repos) ? `${p.repos} repos` : "unlimited repos"} · {p.seats} seats
                </p>
              </button>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={creditsModal}
        title="Buy add-on credits"
        onClose={() => setCreditsModal(false)}
        footer={
          <>
            <Button text="Cancel" variant="secondary-md" type="button" onClick={() => setCreditsModal(false)} />
            <Button
              text={`Pay ${money(packs[pack].price, 0)}`}
              type="button"
              onClick={() => {
                buyCredits(packs[pack].credits, packs[pack].price);
                setCreditsModal(false);
                toast(`${packs[pack].credits} credits added`);
              }}
            />
          </>
        }
      >
        <p className="t-body wrap">
          Add-on credits are used after the plan's included credits and never expire. Charged to{" "}
          {w.paymentMethod ? `${w.paymentMethod.brand} •••• ${w.paymentMethod.last4}` : "your card"}.
        </p>
        <div className={styles.formStack}>
          {packs.map((p, i) => (
            <button
              key={p.credits}
              type="button"
              className={`fb ${styles.card} ${pack === i ? styles.cardSelected : ""}`}
              onClick={() => setPack(i)}
              style={{ cursor: "pointer", textAlign: "left", padding: 14 }}
            >
              <div className={styles.cardHead}>
                <span className="t-body-strong pre">{p.credits.toLocaleString("en-US")} credits</span>
                <span className={styles.cardStatValue}>{money(p.price, 0)}</span>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
