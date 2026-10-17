import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";

import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import type { RuleHighlight } from "@/features/canvas/canvasUiStore";
import { hasRuleTargets } from "@/features/schema/objectDetailsView";
import type { RuleNodeView, RuleTargets, RuleView } from "@/features/schema/objectDetailsView";
import type { RulePart } from "@/features/schema/rules/ruleText";
import { useI18n } from "@/shared/i18n/useI18n";
import { IconButton } from "@/shared/ui/IconButton";
import { classNames } from "@/shared/ui/classNames";

import styles from "./RuleItem.module.css";
import { sqlDisclosure } from "./sqlDisclosure";

/*
 * A `CHECK` or a foreign key as the Inspector reads it out: its sentences, with the columns and
 * tables they name drawn as chips, and its SQL one click away. Pointing at the item, with the
 * mouse or the keyboard, highlights what it involves on the canvas: the columns on their cards
 * and, for a key, its relationship. The viewer draws the same view-model with the DOM.
 */

/** The one table a sentence's table chip may open: the item's other table, when it can be shown. */
export interface TableLink {
  key: string;
  /** Accessible name of the chip, e.g. "Go to dbo.Customers". */
  label: string;
  onFollow: (key: string) => void;
}

type CopyOutcome = "idle" | "copied" | "failed";

/** How long the copy confirmation stays next to the button. */
const FEEDBACK_MILLISECONDS = 2500;

function highlightOf(owner: string, targets: RuleTargets): RuleHighlight {
  return {
    owner,
    columns: new Map([...targets.columns].map(([entity, names]) => [entity, new Set(names)])),
    edgeId: targets.relation,
  };
}

interface RuleItemProps {
  rule: RuleView;
  /** The item's name and badges, drawn at the start of its first line. */
  head: ReactNode;
  /** Lines between the head and the sentences, such as a key's column pairs. */
  children?: ReactNode;
  /** Lines after the sentences, such as the other table of a key and why it may be stale. */
  footer?: ReactNode;
  link: TableLink | null;
}

/**
 * One rule: the head with the SQL toggle at its end, the sentences or the line that says they
 * cannot be given, the item's own lines, and the SQL, shown from the start when there are no
 * sentences. Focusing any control of the item highlights the rule as the pointer does, so the
 * highlight adds no stop for the keyboard of its own.
 */
export function RuleItem({ rule, head, children, footer, link }: RuleItemProps) {
  const { t } = useI18n();
  const owner = useId();
  const sqlId = useId();
  const itemRef = useRef<HTMLLIElement>(null);
  const [storedDisclosure, setDisclosure] = useState(() => sqlDisclosure(rule));
  // A refresh can hand the item its rule read differently; the SQL then starts over, as for a
  // new item. The panel mounts new items for another entity.
  const disclosure = sqlDisclosure(rule, storedDisclosure);
  if (disclosure !== storedDisclosure) {
    setDisclosure(disclosure);
  }
  const isSqlOpen = disclosure.isOpen;
  const setRuleHighlight = useCanvasUiStore((state) => state.setRuleHighlight);
  const clearRuleHighlight = useCanvasUiStore((state) => state.clearRuleHighlight);

  // An item that unmounts while pointed at, when the selection or the language changes, takes
  // its highlight with it.
  useEffect(
    () => () => {
      clearRuleHighlight(owner);
    },
    [owner, clearRuleHighlight],
  );

  const point = () => {
    if (hasRuleTargets(rule.targets)) {
      setRuleHighlight(highlightOf(owner, rule.targets));
    }
  };
  // The highlight stays while either the pointer or the focus is still on the item.
  const leave = () => {
    if (itemRef.current?.contains(document.activeElement) !== true) {
      clearRuleHighlight(owner);
    }
  };
  const blur = (event: FocusEvent<HTMLLIElement>) => {
    const item = event.currentTarget;
    if (!item.contains(event.relatedTarget) && !item.matches(":hover")) {
      clearRuleHighlight(owner);
    }
  };

  return (
    <li
      ref={itemRef}
      className={styles.rule}
      onMouseEnter={point}
      onMouseLeave={leave}
      onFocus={point}
      onBlur={blur}
    >
      <div className={styles.head}>
        {head}
        {rule.sql === null ? null : (
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={isSqlOpen}
            aria-controls={sqlId}
            onClick={() => {
              setDisclosure({ ...disclosure, isOpen: !isSqlOpen });
            }}
          >
            {isSqlOpen ? (
              <ChevronDown className={styles.toggleIcon} aria-hidden="true" />
            ) : (
              <ChevronRight className={styles.toggleIcon} aria-hidden="true" />
            )}
            {t(isSqlOpen ? "rule.sql.hide" : "rule.sql.show")}
          </button>
        )}
      </div>
      {children}
      {rule.unread === null ? (
        <RuleSentences nodes={rule.sentences} link={link} />
      ) : (
        <p className={styles.unread}>{rule.unread}</p>
      )}
      {footer}
      {rule.sql === null ? null : (
        <div id={sqlId} className={styles.sql} hidden={!isSqlOpen}>
          <pre className={styles.sqlText}>
            <code>{rule.sql}</code>
          </pre>
          <div className={styles.sqlBar}>
            {rule.sqlNote === null ? null : <span className={styles.sqlNote}>{rule.sqlNote}</span>}
            <CopySqlButton sql={rule.sql} />
          </div>
        </div>
      )}
    </li>
  );
}

interface RuleSentencesProps {
  nodes: readonly RuleNodeView[];
  link: TableLink | null;
}

/** The sentences as a list; a group's heading leads a nested list of its own sentences. */
function RuleSentences({ nodes, link }: RuleSentencesProps) {
  return (
    <ul className={styles.sentences}>
      {nodes.map((node, index) =>
        node.kind === "sentence" ? (
          <li key={index} className={styles.sentence}>
            <RuleParts parts={node.parts} link={link} />
          </li>
        ) : (
          <li key={index} className={styles.group}>
            <span className={styles.heading}>
              <RuleParts parts={node.heading} link={link} />
            </span>
            <RuleSentences nodes={node.items} link={link} />
          </li>
        ),
      )}
    </ul>
  );
}

interface RulePartsProps {
  parts: readonly RulePart[];
  link: TableLink | null;
}

/**
 * The runs of one sentence: text as it is, a column or a table as a chip, a value or keyword
 * as code. A table chip opens its table when it is the item's other table. The item's own link
 * to that table already takes the keyboard there, so the chips stay out of the tab order and a
 * sentence that names the table twice adds no stops.
 */
function RuleParts({ parts, link }: RulePartsProps) {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.kind) {
          case "text":
            return part.text;
          case "column":
            return (
              <span key={index} className={styles.column}>
                {part.name}
              </span>
            );
          case "table":
            return link !== null && part.key === link.key ? (
              <button
                key={index}
                type="button"
                tabIndex={-1}
                className={classNames(styles.table, styles.tableLink)}
                aria-label={link.label}
                onClick={() => {
                  link.onFollow(part.key);
                }}
              >
                {part.label}
              </button>
            ) : (
              <span key={index} className={styles.table}>
                {part.label}
              </span>
            );
          case "code":
            return (
              <code key={index} className={styles.code}>
                {part.text}
              </code>
            );
        }
      })}
    </>
  );
}

/** Copies the rule's SQL; the outcome is shown next to the button and announced politely. */
function CopySqlButton({ sql }: { sql: string }) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");

  useEffect(() => {
    if (outcome === "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setOutcome("idle");
    }, FEEDBACK_MILLISECONDS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [outcome]);

  const copy = () => {
    navigator.clipboard.writeText(sql).then(
      () => {
        setOutcome("copied");
      },
      (error: unknown) => {
        console.warn("Could not copy the rule's SQL", error);
        setOutcome("failed");
      },
    );
  };

  return (
    <span className={styles.copy}>
      <span className={styles.feedback} role="status">
        {outcome === "copied"
          ? t("rule.sql.copied")
          : outcome === "failed"
            ? t("rule.sql.copyFailed")
            : null}
      </span>
      <IconButton
        label={t("rule.sql.copy")}
        icon={outcome === "copied" ? Check : Copy}
        className={styles.copyButton}
        onClick={copy}
      />
    </span>
  );
}
