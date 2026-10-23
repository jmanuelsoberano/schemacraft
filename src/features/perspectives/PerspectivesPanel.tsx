import { useId, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { qualifiedNameLabel } from "@/features/schema/entities";
import type { NoteTarget } from "@/shared/contracts/generated/project/NoteTarget";
import type { ProjectNote } from "@/shared/contracts/generated/project/ProjectNote";
import type { SchemaSnapshot } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import { Dialog } from "@/shared/ui/Dialog";
import { Select } from "@/shared/ui/Select";
import { TextField } from "@/shared/ui/TextField";

import { NoteEditor } from "./NoteEditor";
import { activePerspective, noteTargetKey } from "./perspectiveState";
import styles from "./PerspectivesPanel.module.css";

type EditMode = "create" | "duplicate" | "rename";
const GENERAL = "general";

function targetLabel(target: NoteTarget): string {
  const table = qualifiedNameLabel(target.table);
  return target.kind === "table" ? table : `${table} · ${target.column}`;
}

function UnlinkedNote({ note }: { note: ProjectNote }) {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const [targetKey, setTargetKey] = useState("");
  const [hasConflict, setHasConflict] = useState(false);
  if (project === null) return null;
  const targets: NoteTarget[] = project.content.snapshot.tables.flatMap((table) => [
    { kind: "table" as const, table: table.name },
    ...table.columns.map((column) => ({
      kind: "column" as const,
      table: table.name,
      column: column.name,
    })),
  ]);
  const target = targets.find((item) => noteTargetKey(item) === targetKey);
  return (
    <div className={styles.note}>
      <p className={styles.hint}>
        {t("perspectives.formerTarget")}: {targetLabel(note.target)}
      </p>
      <p className={styles.text}>{note.text}</p>
      <Select
        label={t("perspectives.target")}
        value={target === undefined ? undefined : targetKey}
        options={targets.map((item) => ({ value: noteTargetKey(item), label: targetLabel(item) }))}
        onValueChange={(value) => {
          setTargetKey(value);
          setHasConflict(false);
        }}
        placeholder={t("perspectives.emptyTarget")}
        disabled={project.isReadOnly}
      />
      {hasConflict ? (
        <p role="alert" className={styles.error}>
          {t("perspectives.conflict")}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          disabled={project.isReadOnly || target === undefined}
          onClick={() => {
            if (target !== undefined)
              setHasConflict(!useProjectStore.getState().reassignNote(note.id, target));
          }}
        >
          {t("perspectives.reassign")}
        </Button>
        <Button
          disabled={project.isReadOnly}
          onClick={() => {
            useProjectStore.getState().deleteNote(note.id);
          }}
        >
          {t("perspectives.deleteNote")}
        </Button>
      </div>
    </div>
  );
}

/** Management for the active map; ordinary project Save persists every map and note. */
export function PerspectivesPanel() {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const [mode, setMode] = useState<EditMode | null>(null);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const source = useRef<{ snapshot: SchemaSnapshot; perspectiveId: string | null } | null>(null);
  const titleId = useId();
  if (project === null) return null;
  const active = activePerspective(project.content);
  const unlinked = project.content.annotations?.notes.filter((note) => !note.isLinked) ?? [];
  const close = () => {
    setMode(null);
    setSubmitted(false);
  };
  const begin = (next: EditMode) => {
    source.current = { snapshot: project.content.snapshot, perspectiveId: active?.id ?? null };
    setName(next === "rename" ? (active?.name ?? "") : "");
    setSubmitted(false);
    setMode(next);
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (name.trim() === "" || mode === null) return;
    const store = useProjectStore.getState();
    if (source.current === null || store.project?.content.snapshot !== source.current.snapshot) {
      close();
      return;
    }
    if (mode === "rename" && source.current.perspectiveId !== null)
      store.renamePerspective(source.current.perspectiveId, name);
    else if (mode === "duplicate") store.duplicatePerspective(source.current.perspectiveId, name);
    else store.createPerspective(name);
    close();
  };
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h3 className={styles.heading} id={titleId}>
        {t("perspectives.title")}
      </h3>
      <Select
        label={t("perspectives.title")}
        value={active === undefined ? GENERAL : `map:${active.id}`}
        options={[
          { value: GENERAL, label: t("perspectives.general") },
          ...(project.content.perspectives ?? []).map((item) => ({
            value: `map:${item.id}`,
            label: item.name,
          })),
        ]}
        onValueChange={(value) => {
          useProjectStore.getState().selectPerspective(value === GENERAL ? null : value.slice(4));
        }}
        placeholder={t("perspectives.general")}
      />
      <div className={styles.actions}>
        <Button
          disabled={project.isReadOnly}
          onClick={() => {
            begin("create");
          }}
        >
          {t("perspectives.create")}
        </Button>
        <Button
          disabled={project.isReadOnly}
          onClick={() => {
            begin("duplicate");
          }}
        >
          {t("perspectives.duplicate")}
        </Button>
        <Button
          disabled={project.isReadOnly || active === undefined}
          onClick={() => {
            begin("rename");
          }}
        >
          {t("perspectives.rename")}
        </Button>
        <Button
          disabled={project.isReadOnly || active === undefined}
          onClick={() => {
            if (active !== undefined) useProjectStore.getState().deletePerspective(active.id);
          }}
        >
          {t("perspectives.delete")}
        </Button>
      </div>
      {active === undefined ? null : (
        <NoteEditor
          key={active.id}
          label={t("perspectives.description")}
          text={active.description ?? ""}
          disabled={project.isReadOnly}
          hint={t("perspectives.descriptionHint")}
          onChange={(text) => {
            useProjectStore.getState().setPerspectiveDescription(active.id, text);
          }}
        />
      )}
      {unlinked.length === 0 ? null : (
        <details className={styles.details}>
          <summary>
            {t("perspectives.unlinked")} ({unlinked.length})
          </summary>
          <p className={styles.hint}>{t("perspectives.identityHint")}</p>
          {unlinked.map((note) => (
            <UnlinkedNote key={note.id} note={note} />
          ))}
        </details>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={mode === null ? t("perspectives.title") : t(`perspectives.${mode}`)}
        closeLabel={t("perspectives.close")}
      >
        <form onSubmit={submit} className={styles.field}>
          <TextField
            label={t("perspectives.name")}
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            error={submitted && name.trim() === "" ? t("perspectives.nameRequired") : undefined}
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary">
              {t("perspectives.apply")}
            </Button>
            <Button onClick={close}>{t("perspectives.cancel")}</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
