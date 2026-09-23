import type { ReactNode } from "react";
import { FinalCta } from "./FinalCta";
import { Footer } from "./Footer";
import { NavBar } from "./NavBar";
import { Noise } from "./Noise";
import styles from "./SiteFrame.module.css";
import { SmoothScroll } from "./SmoothScroll";

type Props = {
  children: ReactNode;
  /** The home page shows the final call to action above the footer; the 404 page does not. */
  showFinalCta?: boolean;
  /** Section id past which the navbar CTA becomes solid. */
  switchButtonAt?: string;
};

// The shared page frame of the site: smooth scroll, fixed navbar, noise, content, CTA and footer.
export function SiteFrame({ children, showFinalCta = true, switchButtonAt }: Props) {
  return (
    <div className={styles.frame}>
      <SmoothScroll />
      <NavBar switchAt={switchButtonAt} />
      <Noise />
      {children}
      <div className={styles.spacer} />
      {showFinalCta && <FinalCta />}
      <Footer />
    </div>
  );
}
