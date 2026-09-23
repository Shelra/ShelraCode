"use client";

import { GithubLogoIcon } from "@/components/ui/Icons";
import { SocialsButton } from "@/components/ui/SocialsButton";
import { Wordmark } from "@/components/ui/Wordmark";
import { footer, links } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import styles from "./Footer.module.css";

export function Footer() {
  const bp = useBreakpoint();
  const mobile = bp !== "desktop";
  return (
    <footer
      className={`${styles.footer} ${bp === "tablet" ? styles.tablet : ""} ${bp === "phone" ? styles.phone : ""}`}
    >
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.top}>
            <a href="/" className={styles.logo}>
              <Wordmark size={20} />
            </a>
            <p className={`t-body balance ${styles.tagline}`}>{footer.tagline}</p>
            <div className={styles.socials}>
              <SocialsButton href={links.github} label="ShelraCode on GitHub" icon={GithubLogoIcon} mobile={mobile} />
            </div>
          </div>
          <div className={styles.createdBy}>
            <div className={styles.credit}>
              <p className="t-body pre">{footer.builtBy}</p>
            </div>
            <div className={styles.credit}>
              <p className="t-small-strong pre">
                <a href={links.author} target="_blank" rel="noopener" className="link-footer">
                  {footer.author}
                </a>
              </p>
            </div>
            <div className={styles.credit}>
              <p className="t-body pre">{footer.separator}</p>
            </div>
            <div className={styles.credit}>
              <p className="t-small-strong pre">
                <a href={links.license} target="_blank" rel="noopener" className="link-footer">
                  {footer.license}
                </a>
              </p>
            </div>
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.column}>
            <p className="t-small-strong wrap">{footer.navigationTitle}</p>
            {footer.navigation.map((item) => (
              <p key={item.label} className="t-body wrap">
                <a href={item.href} className="link-footer">
                  {item.label}
                </a>
              </p>
            ))}
          </div>
          <div className={styles.column}>
            <p className="t-small-strong wrap">{footer.socialsTitle}</p>
            {footer.socials.map((item) => (
              <p key={item.label} className="t-body wrap">
                <a
                  href={item.href}
                  className="link-footer"
                  {...(item.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener" })}
                >
                  {item.label}
                </a>
              </p>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
