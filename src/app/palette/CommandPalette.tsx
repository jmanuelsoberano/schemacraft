import { CornerDownLeft, Glasses, Search, Table2 } from "lucide-react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import type { AppActions } from "@/app/actions/useAppActions";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useProjectStore } from "@/features/project/projectStore";
import { listEntities } from "@/features/schema/entities";
import { useI18n } from "@/shared/i18n/useI18n";
import { Kbd } from "@/shared/ui/Kbd";
import { classNames } from "@/shared/ui/classNames";

import styles from "./CommandPalette.module.css";
import { searchPalette } from "./paletteSearch";
import type { PaletteAction, PaletteEntity, PaletteResult } from "./paletteSearch";
import { usePaletteStore } from "./paletteStore";

interface CommandPaletteProps {
  actions: AppActions;
}

function resultKey(result: PaletteResult): string {
  return result.kind === "action" ? `action:${result.action.id}` : `entity:${result.entity.key}`;
}

/** Every action and every entity of the open project, reachable by name with Ctrl+K. */
export function CommandPalette({ actions }: CommandPaletteProps) {
  const { t } = useI18n();
  const isOpen = usePaletteStore((state) => state.isOpen);
  const close = usePaletteStore((state) => state.close);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          aria-describedby={undefined}
          data-command-palette=""
        >
          <VisuallyHidden.Root>
            <Dialog.Title>{t("palette.title")}</Dialog.Title>
          </VisuallyHidden.Root>
          {/* Mounted only while open, so the query and the cursor start fresh every time. */}
          <PaletteSearch actions={actions} onDone={close} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PaletteSearchProps {
  actions: AppActions;
  onDone: () => void;
}

function PaletteSearch({ actions, onDone }: PaletteSearchProps) {
  const { t } = useI18n();
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const paletteActions = useMemo<PaletteAction[]>(
    () =>
      actions.list.map((action) => ({
        id: action.id,
        label: t(action.labelKey),
        shortcut: action.shortcut ? formatShortcut(action.shortcut, isApplePlatform()) : null,
        isAvailable: action.isAvailable,
      })),
    [actions.list, t],
  );
  const paletteEntities = useMemo<PaletteEntity[]>(
    () => (snapshot === null ? [] : listEntities(snapshot)),
    [snapshot],
  );
  const results = useMemo(
    () => searchPalette(query, paletteActions, paletteEntities),
    [query, paletteActions, paletteEntities],
  );
  const activeIndex = Math.min(cursor, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (result: PaletteResult) => {
    onDone();
    if (result.kind === "action") {
      actions.byId[result.action.id].run();
    } else {
      focusEntity(result.entity.key);
    }
  };

  return (
    <>
      <label className={styles.search}>
        <Search className={styles.searchIcon} aria-hidden="true" />
        <input
          className={styles.input}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor(Math.min(activeIndex + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor(Math.max(activeIndex - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const active = results[activeIndex];
              if (active !== undefined) {
                run(active);
              }
            }
          }}
        />
        <Kbd>Esc</Kbd>
      </label>
      {results.length === 0 ? (
        <p className={styles.empty}>{t("palette.noResults", { query })}</p>
      ) : (
        <ul className={styles.list} ref={listRef} role="listbox" aria-label={t("palette.title")}>
          {results.map((result, index) => (
            <li
              key={resultKey(result)}
              data-index={index}
              role="option"
              aria-selected={index === activeIndex}
              className={classNames(styles.item, index === activeIndex && styles.active)}
              onMouseEnter={() => {
                setCursor(index);
              }}
              onClick={() => {
                run(result);
              }}
            >
              {result.kind === "action" ? (
                <>
                  <CornerDownLeft className={styles.itemIcon} aria-hidden="true" />
                  <span className={styles.itemLabel}>{result.action.label}</span>
                  {result.action.shortcut ? <Kbd>{result.action.shortcut}</Kbd> : null}
                </>
              ) : (
                // The kind is written out, so a view is told apart with the colour alone.
                <>
                  {result.entity.kind === "view" ? (
                    <Glasses
                      className={classNames(styles.itemIcon, styles.viewIcon)}
                      aria-hidden="true"
                    />
                  ) : (
                    <Table2 className={styles.itemIcon} aria-hidden="true" />
                  )}
                  <span className={styles.itemLabel}>
                    <span className={styles.schema}>{result.entity.schema}.</span>
                    {result.entity.name}
                  </span>
                  <span
                    className={classNames(
                      styles.kind,
                      result.entity.kind === "view" && styles.kindView,
                    )}
                  >
                    {t(result.entity.kind === "view" ? "entity.view" : "entity.table")}
                  </span>
                  <span className={styles.hint}>{t("palette.centerOn")}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
