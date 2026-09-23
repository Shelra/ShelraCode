import summary from "@/lib/bench-summary.json";
import { links } from "@/lib/content";
import styles from "./doc.module.css";
import { Rich } from "./Rich";

// Measured results on the guide pages. Every number comes from bench-summary.json (bun run bench:sync, generated
// from bench/history); nothing here is typed by hand.

function Outcome({ passed }: { passed: boolean | null }) {
  if (passed === null) return <span className="muted">not run</span>;
  // Glyph and word, not colour alone.
  return passed ? <span className={styles.pass}>✓ passed</span> : <span className="muted">✗ failed</span>;
}

/** The memory proof suite, arm by arm, with the totals. */
export function MemoryRuns() {
  const { memory } = summary;
  const total = memory.runs.length;
  const passed = (key: "learn" | "withMemory" | "withoutMemory") => memory.runs.filter((run) => run[key]).length;
  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard must reach a box that scrolls sideways on a phone to scroll it (WCAG 2.1.1) */}
      <section className={styles.tableWrap} aria-label="Memory suite runs" tabIndex={0}>
        <table className={styles.table}>
          <caption className={`t-small-mono ${styles.caption}`}>
            {memory.suite} · {memory.model}
          </caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">B · with memory</th>
              <th scope="col">B · memory wiped</th>
              <th scope="col">A · learn</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {memory.runs.map((run) => (
              <tr key={run.runNumber}>
                <td className={styles.mono}>#{run.runNumber}</td>
                <td>
                  <Outcome passed={run.withMemory} />
                </td>
                <td>
                  <Outcome passed={run.withoutMemory} />
                </td>
                <td>
                  <Outcome passed={run.learn} />
                </td>
                <td className={styles.mono}>{run.date}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Passed</th>
              <td>
                {passed("withMemory")} of {total}
              </td>
              <td>
                {passed("withoutMemory")} of {total}
              </td>
              <td>
                {passed("learn")} of {total}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>
      <p className={`t-small ${styles.note}`}>
        <Rich text={memoryNote(total)} />
      </p>
    </>
  );
}

// The table's caveats. The classification of runs #12 to #16 is quoted from the harness log (docs/architecture/14,
// section 24), which is where it is recorded; everything else comes from the summary.
function memoryNote(total: number): string {
  const { memory } = summary;
  const others = memory.otherRuns.map(
    (run) =>
      `#${run.runNumber} (${run.model === memory.model ? "" : `${run.model}, `}${statusLabel[run.status] ?? run.status})`,
  );
  return [
    `Completed runs on one model, ${total} of them: a small sample.`,
    others.length ? `Not in the table: ${others.join(" and ")}.` : null,
    `The [harness log](${links.harnessLog}) counts runs #12 and #13 as invalid for this question (a reflection that returned nothing; a workspace copy that skipped \`.shelra\`) and traces the failures of #15 and #16 to tool and harness defects, all since fixed.`,
    memory.runs.some((run) => run.date <= REWRITE)
      ? `Runs from before ${REWRITE} record commits from before the repository's history was rewritten, so they cannot be replayed from public commits.`
      : null,
    `[Every run is in the history](${links.benchHistory}).`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** How many calls a real task made: field case 001. */
export function FieldCaseRequests() {
  const fieldCase = summary.fieldCases.find((c) => c.toolCalls !== null && c.solved);
  if (!fieldCase) return null;
  return (
    <p className={`t-small ${styles.p}`}>
      <Rich
        text={`A coding task is many model requests, not one: each step of the agent is a request, and a step can make several tool calls. [Field case ${fieldCase.id.slice(0, 3)}](${links.fieldCases}), a real problem solved on \`${fieldCase.model}\`, made ${fieldCase.toolCalls} tool calls.`}
      />
    </p>
  );
}

const statusLabel: Record<string, string> = { running: "unfinished" };

/** Field case 001 against its reference agent, and every core-suite run on a free model. */
export function FreeModelResults() {
  const fieldCase = summary.fieldCases.find((c) => c.solved && c.reference);
  const runs = summary.freeRuns;
  return (
    <>
      {fieldCase?.reference && (
        <p className={`t-small ${styles.p}`}>
          <Rich
            text={`[Field case ${fieldCase.id.slice(0, 3)}](${links.fieldCases}), a real problem brought to ShelraCode, was solved on \`${fieldCase.model}\` in ${fieldCase.tries} ${fieldCase.tries === 1 ? "try" : "tries"}; ${fieldCase.reference.agent} needed ${fieldCase.reference.tries}. One case is one sample.`}
          />
        </p>
      )}
      <p className={`t-small ${styles.p}`}>
        Every run of ShelraCode on a free model in the eight-task core suite, whatever its outcome:
      </p>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard must reach a box that scrolls sideways on a phone to scroll it (WCAG 2.1.1) */}
      <section className={styles.tableWrap} aria-label="Core-suite runs on free models" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Resolved</th>
              <th scope="col">Status</th>
              <th scope="col">Model</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runNumber}>
                <td className={styles.mono}>#{run.runNumber}</td>
                <td>
                  {run.resolved} of {run.total}
                </td>
                <td>{statusLabel[run.status] ?? run.status}</td>
                <td className={styles.model}>{run.model}</td>
                <td className={styles.mono}>{run.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className={`t-small ${styles.note}`}>
        <Rich text={freeRunsNote(runs)} />
      </p>
    </>
  );
}

// Runs before the rewrite of 2026-09-22 record commits the public history no longer has.
const REWRITE = "2026-09-22";

// Each sentence holds only while the data says so, so the note stays true as runs are imported.
function freeRunsNote(runs: typeof summary.freeRuns): string {
  const homeIsPaid = summary.rows.every((row) => !row.free);
  const publicFree = runs.some((run) => run.status === "completed" && run.date > REWRITE);
  return [
    homeIsPaid && !publicFree
      ? "The home page's benchmark table shows paid models: no core-suite run on a free model has completed on a public commit yet, and new runs appear here as they are recorded."
      : null,
    runs.some((run) => run.date <= REWRITE)
      ? `Runs from before ${REWRITE} record commits from before the repository's history was rewritten, so they cannot be replayed from public commits.`
      : null,
    `[Every run is in the history](${links.benchHistory}).`,
  ]
    .filter(Boolean)
    .join(" ");
}
