"use client";

import { motion } from "motion/react";
import { Appear } from "@/components/motion/Appear";
import { TextAppear } from "@/components/motion/TextAppear";
import { SectionBadge } from "@/components/ui/SectionBadge";
import type { PasswordFormState } from "@/lib/auth-page";
import type { AuthProviderInfo } from "@/lib/auth-providers";
import { authCopy } from "@/lib/content";
import styles from "./AuthPanel.module.css";
import { CredentialsForm } from "./CredentialsForm";
import { ProviderButton } from "./ProviderButton";

type Props = {
  mode: "login" | "signup";
  providers: AuthProviderInfo[];
  /** Server action that starts a provider's OAuth flow. */
  action: (formData: FormData) => Promise<void>;
  /** Server action of the email + password form. */
  passwordAction: (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
  /** Same-origin path to land on after signing in. */
  redirectTo: string;
  error?: { code: string; provider?: string; providerName: string };
};

const ease = [0.12, 0.23, 0.17, 0.99] as const;
const rise = (delay: number) => ({
  initial: { opacity: 0.001, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "tween", delay, duration: 1, ease } as const,
});

/*
 * The left column of the sign-in and sign-up pages: section badge, two-tone
 * heading, supporting line, one form per OAuth provider, an "or" rule, the
 * email + password form, the legal line and the link to the other page.
 * Everything appears with the site's stagger.
 */
export function AuthPanel({ mode, providers, action, passwordAction, redirectTo, error }: Props) {
  const copy = authCopy[mode];
  const back = mode === "login" ? "/login" : "/signup";
  const message = error
    ? (authCopy.errors[error.code] ?? authCopy.errors.default).replace("{provider}", error.providerName)
    : null;

  return (
    <div className={styles.panel}>
      <div className={styles.texts}>
        <Appear onMount transition={{ type: "tween", duration: 1, ease, delay: 0 }}>
          <SectionBadge text={copy.badge} />
        </Appear>
        <Appear onMount transition={{ type: "tween", duration: 1, ease, delay: 0.2 }}>
          <h1 className={`t-h1 balance ${styles.heading}`}>
            {copy.heading[0]}
            <span className="muted">{copy.heading[1]}</span>
          </h1>
        </Appear>
        <TextAppear
          as="p"
          text={copy.supporting}
          tokenization="line"
          blur={10}
          y={20}
          startDelay={0.4}
          duration={0.7}
          className={`t-small balance ${styles.supporting}`}
        />
      </div>

      {message && (
        <motion.div
          className={`fb ${styles.alert}`}
          role="alert"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "tween", duration: 0.5, ease }}
        >
          <span className={styles.alertGlyph}>✗</span>
          <p className="t-small-strong wrap">{message}</p>
        </motion.div>
      )}

      <div className={styles.providers}>
        {providers.map((provider, i) => (
          <motion.form key={provider.id} action={action} className={styles.form} {...rise(0.5 + 0.1 * i)}>
            <input type="hidden" name="provider" value={provider.id} />
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input type="hidden" name="back" value={back} />
            <ProviderButton id={provider.id} name={provider.name} configured={provider.configured} primary={i === 0} />
          </motion.form>
        ))}
      </div>

      <motion.div className={styles.divider} aria-hidden="true" {...rise(0.7)}>
        <span className={styles.rule} />
        <p className={`t-small-mono pre ${styles.or}`}>{authCopy.form.or}</p>
        <span className={styles.rule} />
      </motion.div>

      <motion.div className={styles.credentials} {...rise(0.8)}>
        <CredentialsForm mode={mode} action={passwordAction} redirectTo={redirectTo} />
      </motion.div>

      <motion.p className={`t-small-mono wrap ${styles.legal}`} {...rise(0.95)}>
        {authCopy.legal}
      </motion.p>

      <motion.p className={`t-small-strong pre ${styles.switch}`} {...rise(1.05)}>
        {copy.switchText}{" "}
        <a href={copy.switchHref} className={styles.switchLink}>
          {copy.switchLink}
        </a>
      </motion.p>
    </div>
  );
}
