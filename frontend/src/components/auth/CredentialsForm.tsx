"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import type { PasswordFormState } from "@/lib/auth-page";
import { authCopy } from "@/lib/content";
import styles from "./CredentialsForm.module.css";

type Props = {
  mode: "login" | "signup";
  /** Server action: signs in, or creates the account and signs in. */
  action: (state: PasswordFormState, formData: FormData) => Promise<PasswordFormState>;
  /** Same-origin path to land on afterwards. */
  redirectTo: string;
};

/*
 * Email + password (plus the name when creating an account). Fields are the
 * site's surface with an inner hairline that turns accent on focus; the
 * message of a failed attempt shows above the button and the values stay.
 */
export function CredentialsForm({ mode, action, redirectTo }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const copy = authCopy.form;
  const modeCopy = copy[mode];

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={`t-small-mono pre ${styles.label}`}>{copy.name}</span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            maxLength={80}
            placeholder={copy.namePlaceholder}
            defaultValue={state?.name ?? ""}
            className={styles.input}
          />
        </label>
      )}
      <label className={styles.field}>
        <span className={`t-small-mono pre ${styles.label}`}>{copy.email}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={copy.emailPlaceholder}
          defaultValue={state?.email ?? ""}
          className={styles.input}
        />
      </label>
      <label className={styles.field}>
        <span className={`t-small-mono pre ${styles.label}`}>{copy.password}</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          placeholder={modeCopy.passwordPlaceholder}
          className={styles.input}
        />
      </label>
      {state?.error && (
        <p role="alert" className={`t-small-strong wrap ${styles.error}`}>
          <span className={styles.glyph}>✗</span>
          {state.error}
        </p>
      )}
      <Button
        text={pending ? modeCopy.pending : modeCopy.submit}
        variant="primary-md"
        showIcon
        disabled={pending}
        className={styles.submit}
      />
    </form>
  );
}
