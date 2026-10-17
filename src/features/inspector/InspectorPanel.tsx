import { MousePointerClick, SquareDashedMousePointer, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { focusEntityNode } from "@/features/canvas/canvasFocus";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useProjectStore } from "@/features/project/projectStore";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import { presentObjectDetails } from "@/features/schema/objectDetailsView";
import type { DetailsView } from "@/features/schema/objectDetailsView";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";
import { classNames } from "@/shared/ui/classNames";

import styles from "./InspectorPanel.module.css";
import { InspectorSection } from "./InspectorSections";
import { inspectedKey, inspectorScope } from "./inspectorScope";

interface InspectorPanelProps {
  /** Formatted shortcut of the toggle action, shown on the close button and in the empty state. */
  toggleShortcutHint?: string;
  /** Opens the Access report, which says why a fact is not visible to this login. */
  onShowAccessReport: () => void;
  /**
   * The handle on the panel's edge, which the shell owns with the width. It is drawn inside
   * the panel, so Escape on it returns to the canvas like Escape anywhere else in the panel.
   */
  resizer?: ReactNode;
}

/**
 * The details of the selected table or view: columns, keys, indexes, `CHECK`s and relations,
 * each fact with how far the capture vouches for it and every `CHECK` and key in words, from
 * the same view-model the exported HTML draws. The panel follows the canvas selection and holds
 * no state of its own; the rule a reader points at goes to the canvas store, which highlights
 * it on the cards. It shows an empty state while nothing or several entities are selected. The
 * shell places it in a complementary landmark, never a dialog, so shortcuts keep working while
 * it is open. It takes focus when the opening asks for it, which every way in but a double-click
 * does; Escape hands focus back to the inspected card and leaves the panel open; the close
 * button and the toggle shortcut close it.
 */
export function InspectorPanel({
  toggleShortcutHint,
  onShowAccessReport,
  resizer,
}: InspectorPanelProps) {
  const translator = useI18n();
  const { t, tCount } = translator;
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const nodes = useProjectStore((state) => state.project?.content.canvas.nodes ?? null);
  const inspection = useProjectStore((state) => state.project?.content.inspection ?? null);
  const selectedKeys = useCanvasUiStore((state) => state.selectedKeys);
  const focusRequest = useCanvasUiStore((state) => state.inspectorFocusRequest);
  const closeInspector = useCanvasUiStore((state) => state.closeInspector);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const key = inspectedKey(selectedKeys);
  const scope = useMemo(
    () =>
      snapshot === null || nodes === null || inspection === null
        ? null
        : inspectorScope(snapshot, nodes, inspection),
    [snapshot, nodes, inspection],
  );
  const view = useMemo<DetailsView | null>(() => {
    if (snapshot === null || scope === null || key === null) {
      return null;
    }
    const details = describeObjectDetails(snapshot, key, scope);
    return details === null ? null : presentObjectDetails(details, translator);
  }, [snapshot, scope, key, translator]);

  // A focus request: focus lands on the entity's heading, or on the panel's own
  // title while nothing is shown. The landmark leaves its inert state in the same render, so
  // focus waits for the browser to have applied it.
  useEffect(() => {
    if (focusRequest === 0) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      (headingRef.current ?? titleRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focusRequest]);

  // Escape returns to the canvas from anywhere in the panel, its resize handle included: the
  // inspected card, or the canvas itself when the card is not rendered. The panel stays open,
  // as a panel meant to be read while working should.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      focusEntityNode(key);
    }
  };

  return (
    <div className={styles.panel} onKeyDown={handleKeyDown}>
      {resizer}
      <div className={styles.header}>
        <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
          {t("inspector.title")}
        </h2>
        <IconButton
          label={t("inspector.close")}
          icon={X}
          shortcutHint={toggleShortcutHint}
          onClick={closeInspector}
        />
      </div>
      <div className={classNames(styles.body, "selectable")}>
        {view !== null ? (
          <>
            <header className={styles.entity}>
              <span className={classNames(styles.kind, view.kind === "view" && styles.kindView)}>
                {view.kindLabel}
              </span>
              <h3 ref={headingRef} tabIndex={-1} className={styles.name}>
                <span className={styles.schema}>{view.schema}.</span>
                {view.name}
              </h3>
              <span className={styles.summary}>{view.summary}</span>
              {view.notice === null ? null : <p className={styles.notice}>{view.notice}</p>}
            </header>
            {/* Keyed by the entity too, so another table's rules get items of their own. */}
            {view.sections.map((section) => (
              <InspectorSection
                key={`${view.key}:${section.kind}`}
                section={section}
                entityKey={view.key}
                onShowAccessReport={onShowAccessReport}
              />
            ))}
          </>
        ) : selectedKeys.length > 1 ? (
          <EmptyState
            icon={SquareDashedMousePointer}
            title={tCount("inspector.multiple.title", selectedKeys.length)}
            description={t("inspector.multiple.description")}
          />
        ) : (
          <EmptyState
            icon={MousePointerClick}
            title={t("inspector.empty.title")}
            description={t("inspector.empty.description", {
              shortcut: toggleShortcutHint ?? t("action.toggleInspector"),
            })}
          />
        )}
      </div>
    </div>
  );
}
