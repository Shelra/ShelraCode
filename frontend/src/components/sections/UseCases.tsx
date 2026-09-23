"use client";

import { motion } from "motion/react";
import { useId, useRef, useState } from "react";
import { Appear } from "@/components/motion/Appear";
import { Button } from "@/components/ui/Button";
import { BlocksIcon, BugIcon, CheckIcon, FlaskConicalIcon, type IconProps } from "@/components/ui/Icons";
import { useCases } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";
import styles from "./UseCases.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;
const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;
const icons: ((props: IconProps) => React.JSX.Element)[] = [BugIcon, BlocksIcon, FlaskConicalIcon];

export function UseCases() {
  const bp = useBreakpoint();
  const mobile = bp !== "desktop";
  const [active, setActive] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between tabs and select them (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (event: React.KeyboardEvent) => {
    const last = useCases.tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? active === last
          ? 0
          : active + 1
        : event.key === "ArrowLeft"
          ? active === 0
            ? last
            : active - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <section className={shared.section} id="use-cases">
      <SectionHeading badge={useCases.badge} heading={useCases.heading as [string, string]} maxWidth={540} />
      <Appear className={styles.wrap} threshold={0} transition={{ type: "tween", delay: 0.2, duration: 1, ease }}>
        <div className={styles.useCases}>
          <div className={styles.content}>
            <div
              className={`${styles.top} ${mobile ? styles.topMobile : ""}`}
              role="tablist"
              aria-label={useCases.badge}
              onKeyDown={onKeyDown}
            >
              {useCases.tabs.map((label, i) => (
                <Tab
                  key={label}
                  ref={(element) => {
                    tabs.current[i] = element;
                  }}
                  id={`${id}-tab-${i}`}
                  panel={`${id}-panel-${i}`}
                  label={label}
                  icon={icons[i]}
                  active={i === active}
                  mobile={mobile}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
            <div className={styles.bottom}>
              {/* Every use case is in the server HTML; the ones not selected are hidden. */}
              {useCases.items.map((item, i) => (
                <UseCaseItem
                  key={item.title}
                  id={`${id}-panel-${i}`}
                  tab={`${id}-tab-${i}`}
                  hidden={i !== active}
                  item={item}
                  mobile={mobile}
                />
              ))}
            </div>
          </div>
        </div>
      </Appear>
    </section>
  );
}

type TabProps = {
  ref: React.Ref<HTMLButtonElement>;
  id: string;
  panel: string;
  label: string;
  icon: (props: IconProps) => React.JSX.Element;
  active: boolean;
  mobile: boolean;
  onClick: () => void;
};

function Tab({ ref, id, panel, label, icon: Icon, active, mobile, onClick }: TabProps) {
  const [hover, setHover] = useState(false);
  const background = mobile
    ? active
      ? "var(--accent)"
      : "var(--base)"
    : hover && !active
      ? "var(--surface)"
      : "var(--base)";
  const iconColor = mobile ? (active ? "var(--on-light)" : "var(--subtle)") : "var(--default)";
  return (
    <motion.button
      ref={ref}
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={panel}
      tabIndex={active ? 0 : -1}
      className={`${styles.tab} ${mobile && !active ? `fb ${styles.tabOutline}` : ""}`}
      onClick={onClick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      initial={false}
      animate={{ backgroundColor: background }}
      transition={spring}
    >
      <span className={`${styles.tabInner} ${mobile ? styles.tabInnerMobile : ""}`}>
        {!mobile && (
          <motion.span
            className={styles.underline}
            initial={false}
            animate={{ backgroundColor: active ? "var(--accent)" : "var(--accent-0)" }}
            transition={spring}
          />
        )}
        <motion.span className={styles.tabIcon} initial={false} animate={{ color: iconColor }} transition={spring}>
          <Icon size={mobile ? 12 : 16} strokeWidth={2} color="currentColor" />
        </motion.span>
        <span
          className={`${mobile ? "t-small-mono" : "t-body-mono"} pre ${styles.tabTitle}`}
          style={{
            textAlign: "center",
            color: mobile ? (active ? "var(--on-light)" : "var(--subtle)") : "var(--default)",
          }}
        >
          {label}
        </span>
      </span>
    </motion.button>
  );
}

type ItemProps = {
  id: string;
  tab: string;
  hidden: boolean;
  item: (typeof useCases.items)[number];
  mobile: boolean;
};

function UseCaseItem({ id, tab, hidden, item, mobile }: ItemProps) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={tab}
      hidden={hidden}
      className={`${styles.item} ${mobile ? styles.itemMobile : ""}`}
    >
      <div className={styles.left}>
        <div className={`fb ${styles.leftCard}`}>
          <div className={styles.leftTexts}>
            <h3 className="t-body-strong wrap">{item.title}</h3>
            <p className="t-body wrap">{item.description}</p>
          </div>
          <div className={styles.checks}>
            {item.checks.map((check) => (
              <div key={check} className={styles.check}>
                <CheckIcon size={16} strokeWidth={2} color="var(--accent)" className={styles.checkIcon} />
                <p className="t-body wrap" style={{ color: "var(--default)", flex: "1 0 0px", width: 1 }}>
                  {check}
                </p>
              </div>
            ))}
          </div>
          <Button text={item.button} href={item.link} variant="primary-sm" />
        </div>
        {!mobile && <div className={`fb ${styles.leftBack}`} />}
      </div>
      <div className={`fb ${styles.right}`}>
        <div className={`fb ${styles.image}`} style={{ aspectRatio: `${item.image.width} / ${item.image.height}` }}>
          <img
            src={item.image.src}
            alt={item.image.alt}
            width={item.image.width}
            height={item.image.height}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
