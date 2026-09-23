import type { Metadata } from "next";
import { Hero } from "@/components/hero/Hero";
import { SiteFrame } from "@/components/layout/SiteFrame";
import { Benchmark } from "@/components/sections/Benchmark";
import { Benefits } from "@/components/sections/Benefits";
import { Faq } from "@/components/sections/Faq";
import { Features } from "@/components/sections/Features";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Pricing } from "@/components/sections/Pricing";
import { SocialProof } from "@/components/sections/SocialProof";
import { Testimonials } from "@/components/sections/Testimonials";
import { UseCases } from "@/components/sections/UseCases";
import { JsonLd } from "@/components/seo/JsonLd";
import { seo } from "@/lib/content";
import { pageMetadata } from "@/lib/metadata";
import { homeGraph } from "@/lib/structured-data";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({
  path: "/",
  title: seo.title,
  description: seo.description,
  absoluteTitle: true,
});

export default function Home() {
  return (
    <SiteFrame switchButtonAt="social-proof">
      <JsonLd data={homeGraph()} />
      <div className={styles.page}>
        <Hero />
        <SocialProof />
        <Benchmark />
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
