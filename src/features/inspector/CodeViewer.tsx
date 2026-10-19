import { ArrowDown, ArrowUp, Search, WrapText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { useI18n } from "@/shared/i18n/useI18n";
import { useSettingsStore } from "@/shared/settings/settingsStore";
import { CopyButton } from "@/shared/ui/CopyButton";
import { IconButton } from "@/shared/ui/IconButton";
import { classNames } from "@/shared/ui/classNames";
import { codeViewerCommand } from "@/shared/ui/codeViewerKeyboard";
import { codeLines, codeMatches, codePosition, nextCodeMatch } from "./codeViewerSearch";
import styles from "./CodeViewer.module.css";

/** One read-only source surface. Searching paints ranges without replacing any source nodes. */
export function CodeViewer({ text }: { text: string }) {
  const { t, tCount } = useI18n();
  const wrap = useSettingsStore((state) => state.codeWrap);
  const setWrap = useSettingsStore((state) => state.setCodeWrap);
  const pre = useRef<HTMLPreElement>(null);
  const code = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState({ text, open: false, query: "", index: 0 });
  if (find.text !== text) setFind({ text, open: false, query: "", index: 0 });
  const lines = useMemo(() => codeLines(text), [text]);
  const matches = useMemo(() => codeMatches(text, find.query), [text, find.query]);
  const active = matches.length === 0 ? 0 : Math.min(find.index, matches.length - 1);

  useEffect(() => {
    const source = code.current;
    const viewport = pre.current;
    if (source === null || viewport === null || !find.open) return;
    const ranges = matches.flatMap((match) => {
      const start = codePosition(lines, match.start);
      const end = codePosition(lines, match.end - 1);
      const first = source.children[start.line]?.firstChild;
      const last = source.children[end.line]?.firstChild;
      if (first === null || first === undefined || last === null || last === undefined) return [];
      const range = document.createRange();
      range.setStart(first, start.offset);
      range.setEnd(last, end.offset + 1);
      return [range];
    });
    const highlighted =
      typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
    if (highlighted) {
      const all = new Highlight();
      for (const range of ranges) all.add(range);
      CSS.highlights.set("schemacraft-code-matches", all);
      const current = new Highlight();
      if (ranges[active]) current.add(ranges[active]);
      current.priority = 1;
      CSS.highlights.set("schemacraft-code-current", current);
    }
    const range = ranges[active];
    if (range !== undefined) {
      const bounds = viewport.getBoundingClientRect();
      const target = range.getBoundingClientRect();
      if (target.top < bounds.top || target.bottom > bounds.bottom)
        viewport.scrollTop += target.top - bounds.top - viewport.clientHeight / 2;
      if (target.left < bounds.left || target.right > bounds.right)
        viewport.scrollLeft += target.left - bounds.left - viewport.clientWidth / 2;
    }
    return () => {
      if (highlighted) {
        CSS.highlights.delete("schemacraft-code-matches");
        CSS.highlights.delete("schemacraft-code-current");
      }
    };
  }, [active, find.open, lines, matches, wrap]);

  const openFind = () => {
    setFind((current) => ({ ...current, open: true }));
    window.requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const closeFind = () => {
    setFind((current) => ({ ...current, open: false }));
    pre.current?.focus();
  };
  const move = (backwards: boolean) => {
    if (!find.open) {
      openFind();
      return;
    }
    setFind((current) => ({ ...current, index: nextCodeMatch(active, matches.length, backwards) }));
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = codeViewerCommand(
      event,
      /Mac|iPhone|iPad|iPod/u.test(navigator.userAgent),
      find.open,
    );
    if (command === null) return;
    // The find field keeps its native text selection, while the source selects only its code.
    if (command === "selectAll" && event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    event.stopPropagation();
    if (command === "find") openFind();
    else if (command === "closeFind") closeFind();
    else if (command === "next" || command === "previous") move(command === "previous");
    else if (code.current !== null) {
      const range = document.createRange();
      range.selectNodeContents(code.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  return (
    <div
      className={styles.viewer}
      data-keyboard-owner="code"
      data-find-open={find.open}
      onKeyDown={handleKey}
    >
      <div className={styles.toolbar}>
        <span className={styles.lineCount}>{tCount("codeViewer.lines", lines.length)}</span>
        <IconButton label={t("codeViewer.find")} icon={Search} onClick={openFind} />
        <IconButton
          label={t("codeViewer.wrap")}
          icon={WrapText}
          aria-pressed={wrap}
          isActive={wrap}
          onClick={() => {
            setWrap(!wrap);
          }}
        />
        <CopyButton
          text={text}
          label={t("codeViewer.copy")}
          copiedLabel={t("copy.copied")}
          failedLabel={t("copy.failed")}
          iconOnly
        />
      </div>
      {find.open ? (
        <div className={styles.findBar}>
          <input
            ref={input}
            className={styles.findInput}
            aria-label={t("codeViewer.find")}
            value={find.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setFind((current) => ({ ...current, query: event.target.value, index: 0 }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                move(event.shiftKey);
              }
            }}
          />
          <span role="status" className={styles.matchCount}>
            {t("codeViewer.matches", {
              current: matches.length === 0 ? 0 : active + 1,
              total: matches.length,
            })}
          </span>
          <IconButton
            label={t("codeViewer.previous")}
            icon={ArrowUp}
            disabled={matches.length === 0}
            onClick={() => {
              move(true);
            }}
          />
          <IconButton
            label={t("codeViewer.next")}
            icon={ArrowDown}
            disabled={matches.length === 0}
            onClick={() => {
              move(false);
            }}
          />
          <IconButton label={t("codeViewer.closeFind")} icon={X} onClick={closeFind} />
        </div>
      ) : null}
      <pre
        ref={pre}
        tabIndex={0}
        aria-label={t("codeViewer.source")}
        className={classNames(styles.source, wrap && styles.wrapped)}
      >
        <code ref={code}>
          {lines.map((line, index) => (
            <span key={index} className={styles.line} data-line={index + 1}>
              {line.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
