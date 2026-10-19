import { MousePointerClick, SquareDashedMousePointer, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { focusInspectedHome } from "@/features/canvas/canvasFocus";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useProjectStore } from "@/features/project/projectStore";
import { describeModuleDetails, describeViewDefinition } from "@/features/schema/moduleDetails";
import { presentModuleDetails, presentModuleDefinition } from "@/features/schema/moduleDetailsView";
import { describeObjectDetails } from "@/features/schema/objectDetails";
import { presentObjectDetails } from "@/features/schema/objectDetailsView";
import type { DetailsView } from "@/features/schema/objectDetailsView";
import { useI18n } from "@/shared/i18n/useI18n";
import { EmptyState } from "@/shared/ui/EmptyState";
import { IconButton } from "@/shared/ui/IconButton";
import { classNames } from "@/shared/ui/classNames";

import styles from "./InspectorPanel.module.css";
import { DefinitionSection } from "./DefinitionSection";
import { InspectorSection } from "./InspectorSections";
import { ModuleSection } from "./ModuleSections";
import { inspectedTarget, inspectorScope } from "./inspectorScope";

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
 * The details of the selected entity or module: columns, keys, indexes, `CHECK`s and relations,
 * each fact with how far the capture vouches for it and every `CHECK` and key in words, from
 * the same view-model the exported HTML draws. The panel follows the canvas selection and holds
 * no state of its own; the rule a reader points at goes to the canvas store, which highlights
 * it on the cards. It shows an empty state while nothing or several entities are selected. The
 * shell places it in a complementary landmark, never a dialog, so shortcuts keep working while
 * it is open. It takes focus when the opening asks for it, which every way in but a double-click
 * does; Escape hands focus back to the object's home and leaves the panel open; the close
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
  const selectedModule = useCanvasUiStore((state) => state.selectedModule);
  const focusRequest = useCanvasUiStore((state) => state.inspectorFocusRequest);
  const closeInspector = useCanvasUiStore((state) => state.closeInspector);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const target = useMemo(
    () => inspectedTarget(selectedKeys, selectedModule),
    [selectedKeys, selectedModule],
  );
  const key = target.kind === "entity" ? target.key : null;
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
  const moduleView = useMemo(() => {
    if (snapshot === null || scope === null || target.kind !== "module") return null;
    const details = describeModuleDetails(snapshot, target.ref, scope);
    return details === null ? null : presentModuleDetails(details, translator);
  }, [snapshot, scope, target, translator]);
  const viewDefinition = useMemo(() => {
    if (snapshot === null || view?.kind !== "view") return null;
    const facts = describeViewDefinition(snapshot, view.key);
    return facts === null ? null : presentModuleDefinition(facts, translator);
  }, [snapshot, view, translator]);

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
      focusInspectedHome(selectedKeys, selectedModule);
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
            {viewDefinition === null ? null : (
              <DefinitionSection
                key={`${view.key}:definition`}
                section={viewDefinition}
                onShowAccessReport={onShowAccessReport}
              />
            )}
          </>
        ) : moduleView !== null ? (
          <>
            <header className={styles.entity}>
              <span className={styles.kind}>{moduleView.kindLabel}</span>
              <h3 ref={headingRef} tabIndex={-1} className={styles.name}>
                <span className={styles.schema}>{moduleView.schema}.</span>
                {moduleView.name}
              </h3>
              {moduleView.notice === null ? null : (
                <p className={styles.notice}>{moduleView.notice}</p>
              )}
            </header>
            {moduleView.sections.map((section) => (
              <ModuleSection
                key={`${moduleView.key}:${section.kind}`}
                section={section}
                moduleKey={moduleView.key}
                onShowAccessReport={onShowAccessReport}
              />
            ))}
          </>
        ) : target.kind === "multiple" ? (
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
