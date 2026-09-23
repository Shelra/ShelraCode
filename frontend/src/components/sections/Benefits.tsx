import { Appear } from "@/components/motion/Appear";
import {
  EyeIcon,
  FeatherIcon,
  GitBranchIcon,
  HourglassIcon,
  type IconProps,
  RocketIcon,
  ShieldIcon,
} from "@/components/ui/Icons";
import { benefits } from "@/lib/content";
import styles from "./Benefits.module.css";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

const icons: Record<(typeof benefits.cards)[number]["icon"], (props: IconProps) => React.JSX.Element> = {
  hourglass: HourglassIcon,
  feather: FeatherIcon,
  rocket: RocketIcon,
  eye: EyeIcon,
  gitBranch: GitBranchIcon,
  shield: ShieldIcon,
};

export function Benefits() {
  return (
    <section className={shared.section} id="benefits">
      <SectionHeading badge={benefits.badge} heading={benefits.heading} maxWidth={600} />
      <div className={styles.grid}>
        {benefits.cards.map((card) => {
          const Icon = icons[card.icon];
          return (
            <Appear key={card.title} transition={{ type: "tween", delay: card.delay, duration: 1, ease }}>
              <div className={`fb ${styles.card}`}>
                <div className={styles.container}>
                  <Icon size={24} strokeWidth={2} color="var(--default)" className={styles.icon} />
                  <div className={styles.text}>
                    <h3 className="t-body-strong wrap">{card.title}</h3>
                    <p className="t-small balance">{card.description}</p>
                  </div>
                </div>
              </div>
            </Appear>
          );
        })}
      </div>
    </section>
  );
}
