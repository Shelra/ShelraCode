import { SiteFrame } from "@/components/layout/SiteFrame";
import { JsonLd } from "@/components/seo/JsonLd";
import { Button } from "@/components/ui/Button";
import { SectionBadge } from "@/components/ui/SectionBadge";
import { links } from "@/lib/content";
import { type Block, type Guide, guides } from "@/lib/guides";
import { publicPages } from "@/lib/site";
import { guideGraph } from "@/lib/structured-data";
import { FieldCaseRequests, FreeModelResults, MemoryRuns } from "./DataViews";
import styles from "./doc.module.css";
import { Rich } from "./Rich";

// A guide page: server-rendered, readable without JavaScript, in the site's visual language (section badge,
// two-tone heading, panels with inner borders, flat colour). No entrance animations: the text is there on arrival.

// A stable key from the block's own content (the blocks are static; no ids needed).
function blockKey(block: Block): string {
  switch (block.kind) {
    case "p":
    case "note":
      return `${block.kind}:${block.text.slice(0, 48)}`;
    case "list":
      return `list:${block.items[0]?.slice(0, 48)}`;
    case "code":
      return `code:${block.lines[0]}`;
    case "table":
      return `table:${block.columns.join("|")}`;
    case "data":
      return `data:${block.name}`;
  }
}

const dataViews = {
  "memory-runs": MemoryRuns,
  "field-case-requests": FieldCaseRequests,
  "free-model-results": FreeModelResults,
};

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return (
        <p className={`t-small ${styles.p}`}>
          <Rich text={block.text} />
        </p>
      );
    case "list": {
      const items = block.items.map((item) => (
        <li key={item} className="t-small">
          <Rich text={item} />
        </li>
      ));
      return block.ordered ? <ol className={styles.ol}>{items}</ol> : <ul className={styles.ul}>{items}</ul>;
    }
    case "code":
      return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard must reach a box that scrolls sideways on a phone to scroll it (WCAG 2.1.1)
        <pre className={`fb ${styles.pre}`} tabIndex={0}>
          {block.lines.map((line) => (
            <code key={line} className={styles.line}>
              {line.startsWith("$ ") ? (
                <>
                  <span className={styles.prompt} aria-hidden="true">
                    ${" "}
                  </span>
                  {line.slice(2)}
                </>
              ) : (
                line
              )}
            </code>
          ))}
        </pre>
      );
    case "table":
      return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard must reach a box that scrolls sideways on a phone to scroll it (WCAG 2.1.1)
        <section className={styles.tableWrap} aria-label={block.columns.join(", ")} tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={cell} scope="row">
                        <Rich text={cell} />
                      </th>
                    ) : (
                      <td key={`${row[0]}-${block.columns[i]}`}>
                        <Rich text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      );
    case "note":
      return (
        <p className={`t-small ${styles.note}`}>
          <Rich text={block.text} />
        </p>
      );
    case "data": {
      const View = dataViews[block.name];
      return <View />;
    }
  }
}

export function DocPage({ guide }: { guide: Guide }) {
  const updated = publicPages.find((page) => page.path === guide.path)?.updated;
  const related = guides.filter((other) => other.path !== guide.path);
  return (
    <SiteFrame>
      <JsonLd data={guideGraph(guide)} />
      <article className={styles.page}>
        <header className={styles.header}>
          <nav aria-label="Breadcrumb">
            <ol className={`t-small-mono ${styles.breadcrumb}`}>
              <li className={styles.crumb}>
                <a href="/" className="link-footer">
                  ShelraCode
                </a>
              </li>
              <li className={styles.crumb} aria-current="page">
                {guide.name}
              </li>
            </ol>
          </nav>
          <SectionBadge text={guide.badge} />
          <h1 className={`t-h1 ${styles.title}`}>
            {guide.heading[0]}
            <span className="muted">{guide.heading[1]}</span>
          </h1>
          <p className={`t-small ${styles.lede}`}>
            <Rich text={guide.lede} />
          </p>
          <div className={styles.actions}>
            <Button text="Install ShelraCode" href={links.install} variant="primary-md" />
            <Button
              text={guide.action.label}
              href={guide.action.href}
              variant="secondary-md"
              newTab={!guide.action.href.startsWith("/")}
            />
            {updated && <p className={`t-small-mono muted ${styles.updated}`}>Updated {updated}</p>}
          </div>
          <nav aria-label="On this page" className={`fb ${styles.toc}`}>
            <p className={`t-small-mono ${styles.tocLabel}`}>On this page</p>
            <ol>
              {guide.sections.map((section) => (
                <li key={section.id} className="t-body">
                  <a href={`#${section.id}`} className="link-footer">
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </header>
        {guide.sections.map((section) => (
          <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-title`}>
            <h2 id={`${section.id}-title`} className={`t-h2 ${styles.h2}`}>
              {section.heading}
            </h2>
            {section.blocks.map((block) => (
              <BlockView key={blockKey(block)} block={block} />
            ))}
          </section>
        ))}
        <aside className={styles.related} aria-labelledby="related-title">
          <h2 id="related-title" className={`t-large ${styles.relatedTitle}`}>
            More about ShelraCode
          </h2>
          <ul className={styles.cards}>
            {related.map((other) => (
              <li key={other.path}>
                <a href={other.path} className={`fb ${styles.card}`}>
                  <span className="t-body-strong">{other.name}</span>
                  <span className="t-body">{other.summary}</span>
                </a>
              </li>
            ))}
            <li>
              <a href="/#benchmark" className={`fb ${styles.card}`}>
                <span className="t-body-strong">Benchmark</span>
                <span className="t-body">Every run on record, with its model, cost and commit.</span>
              </a>
            </li>
          </ul>
        </aside>
      </article>
    </SiteFrame>
  );
}
