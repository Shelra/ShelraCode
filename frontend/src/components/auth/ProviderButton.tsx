"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRightIcon, GithubLogoIcon, GoogleLogoIcon } from "@/components/ui/Icons";
import type { AuthProviderId } from "@/lib/auth-providers";
import { authCopy } from "@/lib/content";
import styles from "./ProviderButton.module.css";

type Props = {
  id: AuthProviderId;
  name: string;
  configured: boolean;
  /** The filled (accent) variant; the others are bordered. */
  primary?: boolean;
};

const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;
const icons = { github: GithubLogoIcon, google: GoogleLogoIcon };

/*
 * "Continue with …" — the site's button language (mono label, sliding arrow,
 * spring hover) stretched to a full-width row with the provider's mark. It
 * submits the form around it; while the redirect is on its way the label says so.
 */
export function ProviderButton({ id, name, configured, primary = false }: Props) {
  const { pending } = useFormStatus();
  const [hover, setHover] = useState(false);
  const Icon = icons[id];

  const background = primary ? (hover ? "var(--hover)" : "var(--accent)") : hover ? "var(--white-8)" : "var(--surface)";
  const shadow = primary ? (hover ? "0px 0px 20px 0px var(--accent-16)" : "0px 0px 0px 0px var(--accent-16)") : "none";
  const color = primary ? "var(--on-light)" : "var(--default)";
  const arrow = primary ? "rgb(0, 0, 0)" : hover ? "var(--default)" : "var(--subtle)";
  const label = pending ? authCopy.pending.replace("{provider}", name) : authCopy.providers[id];

  return (
    <motion.button
      type="submit"
      disabled={!configured || pending}
      aria-busy={pending}
      className={`fb ${styles.button} ${primary ? styles.primary : ""} ${hover ? styles.hover : ""}`}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      animate={{ backgroundColor: background, boxShadow: shadow }}
      transition={spring}
      initial={false}
    >
      <Icon size={20} strokeWidth={1.5} color={color} className={styles.icon} />
      <p className={`t-body-mono pre ${styles.label}`} style={{ color }}>
        {label}
      </p>
      {configured ? (
        <div className={styles.arrow}>
          <ArrowRightIcon size={12} strokeWidth={2.5} color={arrow} />
          <ArrowRightIcon size={12} strokeWidth={2.5} color={arrow} />
        </div>
      ) : (
        <p className={`t-small-mono pre ${styles.hint}`} style={{ color: primary ? "var(--on-light)" : undefined }}>
          {authCopy.notConfigured}
        </p>
      )}
    </motion.button>
  );
}
