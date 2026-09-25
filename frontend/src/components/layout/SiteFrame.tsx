import type { ReactNode } from "react";
import { getRepoStars } from "@/lib/github";
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

// The shared page frame of the site: smooth scroll, fixed navbar, noise, content, CTA and footer. A server
// component: it reads the repository's star count for the navbar (cached for an hour, see lib/github.ts).
export async function SiteFrame({ children, showFinalCta = true, switchButtonAt }: Props) {
  const stars = await getRepoStars();
  return (
    <div className={styles.frame}>
      <SmoothScroll />
      <NavBar switchAt={switchButtonAt} stars={stars} />
      <Noise />
      <main className={styles.main}>{children}</main>
      <div className={styles.spacer} />
      {showFinalCta && <FinalCta />}
      <Footer />
    </div>
  );
}
