import {
  CornerDownLeft,
  Glasses,
  ScrollText,
  Search,
  SquareFunction,
  Table2,
  Zap,
} from "lucide-react";
import { Dialog, VisuallyHidden } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import type { AppActions } from "@/app/actions/useAppActions";
import { setHidden } from "@/features/canvas/canvasActions";
import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import { useProjectStore } from "@/features/project/projectStore";
import {
  displayIdentifier,
  entityKey,
  listEntities,
  qualifiedNameLabel,
} from "@/features/schema/entities";
import { listModules } from "@/features/schema/modules";
import type { MessageKey } from "@/shared/i18n/messages/en";
import { useI18n } from "@/shared/i18n/useI18n";
import { Kbd } from "@/shared/ui/Kbd";
import { classNames } from "@/shared/ui/classNames";

import styles from "./CommandPalette.module.css";
import { searchPalette } from "./paletteSearch";
import type { PaletteAction, PaletteObject, PaletteResult } from "./paletteSearch";
import { usePaletteStore } from "./paletteStore";

interface CommandPaletteProps {
  actions: AppActions;
}

function resultKey(result: PaletteResult): string {
  return result.kind === "action" ? `action:${result.action.id}` : `object:${result.object.key}`;
}

/** Every action and every object of the open project, reachable by name with Ctrl+K. */
export function CommandPalette({ actions }: CommandPaletteProps) {
  const { t } = useI18n();
  const isOpen = usePaletteStore((state) => state.isOpen);
  const close = usePaletteStore((state) => state.close);
  const transfersFocus = useRef(false);

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
          onCloseAutoFocus={(event) => {
            if (transfersFocus.current) {
              event.preventDefault();
              transfersFocus.current = false;
            }
          }}
        >
          <VisuallyHidden.Root>
            <Dialog.Title>{t("palette.title")}</Dialog.Title>
          </VisuallyHidden.Root>
          {/* Mounted only while open, so the query and the cursor start fresh every time. */}
          <PaletteSearch
            actions={actions}
            onDone={(showDetails) => {
              transfersFocus.current = showDetails;
              close();
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface PaletteSearchProps {
  actions: AppActions;
  onDone: (showDetails: boolean) => void;
}

function PaletteSearch({ actions, onDone }: PaletteSearchProps) {
  const { t } = useI18n();
  const snapshot = useProjectStore((state) => state.project?.content.snapshot ?? null);
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const setSelectedKeys = useCanvasUiStore((state) => state.setSelectedKeys);
  const selectModule = useCanvasUiStore((state) => state.selectModule);
  const openInspector = useCanvasUiStore((state) => state.openInspector);
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
  const paletteObjects = useMemo<PaletteObject[]>(
    () => (snapshot === null ? [] : [...listEntities(snapshot), ...listModules(snapshot)]),
    [snapshot],
  );
  const results = useMemo(
    () => searchPalette(query, paletteActions, paletteObjects),
    [query, paletteActions, paletteObjects],
  );
  const activeIndex = Math.min(cursor, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const run = (result: PaletteResult) => {
    onDone(result.kind === "object");
    if (result.kind === "action") {
      actions.byId[result.action.id].run();
    } else {
      if ("ref" in result.object) {
        selectModule(result.object.ref, { focus: true });
      } else {
        const nodes = useProjectStore.getState().project?.content.canvas.nodes ?? [];
        if (nodes.some((node) => node.isHidden && entityKey(node.name) === result.object.key)) {
          setHidden([result.object.key], false);
        }
        setSelectedKeys([result.object.key]);
        focusEntity(result.object.key);
        openInspector({ focus: true });
      }
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
                <ObjectResult object={result.object} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const OBJECT_LABELS: Record<PaletteObject["kind"], MessageKey> = {
  table: "entity.table",
  view: "entity.view",
  procedure: "objects.procedure",
  function: "objects.function",
  trigger: "objects.trigger",
  unknown: "objects.unknown",
};

function ObjectResult({ object }: { object: PaletteObject }) {
  const { t } = useI18n();
  const Icon =
    object.kind === "table"
      ? Table2
      : object.kind === "view"
        ? Glasses
        : object.kind === "function"
          ? SquareFunction
          : object.kind === "trigger"
            ? Zap
            : ScrollText;
  const parent = "ref" in object && object.ref.kind === "trigger" ? object.ref.parent : null;
  return (
    <>
      <Icon
        className={classNames(styles.itemIcon, object.kind === "view" && styles.viewIcon)}
        aria-hidden="true"
      />
      <span className={styles.itemLabel}>
        <span className={styles.schema}>{displayIdentifier(object.schema)}.</span>
        {displayIdentifier(object.name)}
        {parent !== null ? (
          <span className={styles.parent}>
            {t("palette.onParent", { name: qualifiedNameLabel(parent) })}
          </span>
        ) : null}
      </span>
      <span className={classNames(styles.kind, object.kind === "view" && styles.kindView)}>
        {t(OBJECT_LABELS[object.kind])}
      </span>
      <span className={styles.hint}>{t("palette.showDetails")}</span>
    </>
  );
}
