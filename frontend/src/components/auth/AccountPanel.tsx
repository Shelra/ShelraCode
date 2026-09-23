"use client";

import { motion } from "motion/react";
import { Appear } from "@/components/motion/Appear";
import { TextAppear } from "@/components/motion/TextAppear";
import { Button } from "@/components/ui/Button";
import { SectionBadge } from "@/components/ui/SectionBadge";
import { authCopy } from "@/lib/content";
import styles from "./AccountPanel.module.css";

export type AccountUser = { name: string | null; email: string | null; image: string | null };

type Props = {
  user: AccountUser;
  /** Display name of the provider the session came from. */
  provider: string;
  /** Formatted expiry of the session. */
  expires: string;
  signOut: (formData: FormData) => Promise<void>;
};

const ease = [0.12, 0.23, 0.17, 0.99] as const;
const rise = (delay: number) => ({
  initial: { opacity: 0.001, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "tween", delay, duration: 1, ease } as const,
});

// The signed-in view: who you are, how you signed in, and the two ways out.
export function AccountPanel({ user, provider, expires, signOut }: Props) {
  const copy = authCopy.account;
  const title = user.name ?? user.email ?? "";
  const initials = title
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

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

      <motion.div className={`fb ${styles.profile}`} {...rise(0.5)}>
        {user.image ? (
          <img src={user.image} alt="" width={48} height={48} className={styles.avatar} referrerPolicy="no-referrer" />
        ) : (
          <div className={styles.initials}>
            <p className="t-body-mono pre">{initials || "?"}</p>
          </div>
        )}
        <div className={styles.identity}>
          <p className="t-body-strong wrap">{title}</p>
          {user.name && user.email && <p className="t-body wrap">{user.email}</p>}
        </div>
        <div className={`fb ${styles.chip}`}>
          <p className="t-small-mono pre">
            {copy.via} {provider}
          </p>
        </div>
      </motion.div>

      <motion.p className={`t-small-mono pre ${styles.meta}`} {...rise(0.6)}>
        {copy.expires} {expires}
      </motion.p>

      <motion.div className={styles.actions} {...rise(0.7)}>
        <Button text={copy.home} href="/" variant="primary-md" newTab={false} />
        <form action={signOut} className={styles.form}>
          <Button text={copy.signOut} variant="secondary-md" />
        </form>
      </motion.div>
    </div>
  );
}
