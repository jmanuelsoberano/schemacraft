import { useState } from "react";

import { useProjectStore } from "@/features/project/projectStore";
import { entityKey } from "@/features/schema/entities";
import type { QualifiedName } from "@/shared/contracts";
import { useI18n } from "@/shared/i18n/useI18n";
import { Select } from "@/shared/ui/Select";

import { NoteEditor } from "./NoteEditor";
import { linkedNote } from "./perspectiveState";
import styles from "./PerspectivesPanel.module.css";

/** Project-owned notes, shared between maps and deliberately separate from captured facts. */
export function ObjectNotes({ table }: { table: QualifiedName }) {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const [column, setColumn] = useState("");
  if (project === null) return null;
  const entity = project.content.snapshot.tables.find(
    (item) => entityKey(item.name) === entityKey(table),
  );
  if (entity === undefined) return null;
  const tableTarget = { kind: "table" as const, table };
  const chosenColumn = entity.columns.some((item) => item.name === column) ? column : "";
  const columnTarget = { kind: "column" as const, table, column: chosenColumn };
  return (
    <section className={styles.panel} aria-label={t("perspectives.notesTitle")}>
      <h4 className={styles.heading}>{t("perspectives.notesTitle")}</h4>
      <p className={styles.hint}>{t("perspectives.sharedHint")}</p>
      <NoteEditor
        label={t("perspectives.tableNote")}
        text={linkedNote(project.content, tableTarget)?.text ?? ""}
        disabled={project.isReadOnly}
        onChange={(text) => useProjectStore.getState().setObjectNote(tableTarget, text)}
      />
      <Select
        label={t("perspectives.column")}
        value={chosenColumn || undefined}
        options={entity.columns.map((item) => ({ value: item.name, label: item.name }))}
        onValueChange={setColumn}
        placeholder={t("perspectives.column")}
      />
      {chosenColumn === "" ? null : (
        <NoteEditor
          key={chosenColumn}
          label={t("perspectives.columnNote")}
          text={linkedNote(project.content, columnTarget)?.text ?? ""}
          disabled={project.isReadOnly}
          onChange={(text) => useProjectStore.getState().setObjectNote(columnTarget, text)}
        />
      )}
    </section>
  );
}
