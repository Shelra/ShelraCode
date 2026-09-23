import { Hero } from "@/components/hero/Hero";
import { SiteFrame } from "@/components/layout/SiteFrame";
import { Benefits } from "@/components/sections/Benefits";
import { Faq } from "@/components/sections/Faq";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Pricing } from "@/components/sections/Pricing";
import { SocialProof } from "@/components/sections/SocialProof";
import { Testimonials } from "@/components/sections/Testimonials";
import { UseCases } from "@/components/sections/UseCases";
import styles from "./page.module.css";

export default function Home() {
  return (
    <SiteFrame switchButtonAt="social-proof">
      <div className={styles.page}>
        <Hero />
        <SocialProof />
        <Features />
        <UseCases />
        <HowItWorks />
        <Benefits />
        <Testimonials />
        <Pricing />
        <Faq />
      </div>
    </SiteFrame>
  );
}
