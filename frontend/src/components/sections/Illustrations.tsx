import styles from "./Illustrations.module.css";

/*
 * The three terminal-style illustrations of the feature cards: a run on the
 * free policy, the project memory ShelraCode recalls, and a verified turn.
 * The lines mirror what the real TUI prints.
 */
export function Illustration({ variant }: { variant: 1 | 2 | 3 }) {
  if (variant === 1) return <Illustration1 />;
  if (variant === 2) return <Illustration2 />;
  return <Illustration3 />;
}

const green = { color: "var(--accent)" } as const;

function Illustration1() {
  return (
    <div className={`fb ${styles.box}`} style={{ gap: 16 }}>
      <div className={styles.lines}>
        <p className="t-body pre">$ shelra</p>
        <p className="t-small-strong pre">&quot;fix the flaky token refresh&quot;</p>
      </div>
      <div className={styles.divider} />
      <div className={styles.lines}>
        <p className="t-body pre">&gt; Policy free · openrouter</p>
        <p className="t-body pre">&gt; Editing src/auth.ts</p>
      </div>
      <div className={styles.progress}>
        <div className={styles.track}>
          <div className={styles.fill} />
        </div>
        <div className={styles.progressRow}>
          <p className="t-small-mono pre">step 4 of 6</p>
          <p className="t-small-mono pre" style={green}>
            80%
          </p>
        </div>
      </div>
      <p className="t-small-strong pre" style={green}>
        &gt; Running bun test_
      </p>
    </div>
  );
}

function Illustration2() {
  return (
    <div className={`fb ${styles.box}`} style={{ gap: 12 }}>
      <div className={`t-body ${styles.tree}`}>
        <p>.shelra/memory/</p>
        <p>
          {"    "}
          <code>├── index.md</code>
        </p>
        <p>
          {"    "}
          <code>
            {"├── "}
            <span style={green}>topics/auth.md</span>
            {"  recalled"}
          </code>
        </p>
        <p>
          {"    "}
          <code>└── history.jsonl</code>
        </p>
        <p>.agents/skills/</p>
        <p>
          {"    "}
          <code>
            {"└── "}
            <span style={green}>release-notes/SKILL.md</span>
          </code>
        </p>
      </div>
      <div className={styles.divider} />
      <p className="t-body pre">
        3 memories ·<span style={green}> 1 skill</span> · AGENTS.md
      </p>
    </div>
  );
}

function Illustration3() {
  return (
    <div className={`fb ${styles.box}`} style={{ gap: 12 }}>
      <div className={styles.prHead}>
        <div className={styles.prTitle}>
          <div className={styles.dot} />
          <p className="t-small-strong pre">verify</p>
        </div>
        <div className={`fb ${styles.openBadge}`}>
          <p className={styles.openText}>PASS</p>
        </div>
      </div>
      <div className={styles.divider} />
      <div className={styles.prBody}>
        <p className={`t-body wrap ${styles.prLine}`}>bun test · 5 pass · 2.0s</p>
        <p className={`t-body wrap ${styles.prLine}`}>
          2 files · <span style={green}>+9</span> −2
        </p>
        <div className={styles.checks}>
          {["AC1 · expiry is exact", "AC2 · token rotates", "AC3 · no regressions"].map((label) => (
            <div key={label} className={styles.check}>
              <div className={styles.ring}>
                <div className={`fb ${styles.ringOuter}`} />
                <div className={styles.ringInner} />
              </div>
              <p className="t-body pre">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
