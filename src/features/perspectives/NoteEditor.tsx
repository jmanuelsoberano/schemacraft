import { useId } from "react";

import { useProjectStore } from "@/features/project/projectStore";

import styles from "./PerspectivesPanel.module.css";

interface NoteEditorProps {
  label: string;
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
  hint?: string;
}

/** Edits reach the project immediately; one focus session is one undo group. */
export function NoteEditor({ label, text, disabled, onChange, hint }: NoteEditorProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className={styles.textarea}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onBlur={() => {
          useProjectStore.getState().finishNoteEdit();
        }}
        aria-describedby={hint === undefined ? undefined : hintId}
      />
      {hint === undefined ? null : (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
