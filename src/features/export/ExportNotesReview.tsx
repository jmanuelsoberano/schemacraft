import { useExportStore } from "@/features/export/exportStore";
import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { Checkbox } from "@/shared/ui/Checkbox";

import {
  activeCanvas,
  activePerspective,
  exportableNotes,
  noteTargetLabel,
} from "@/features/perspectives/perspectiveState";
import styles from "@/features/perspectives/PerspectivesPanel.module.css";

/** Explicit per-export opt-in; only the checked literal text may enter the file. */
export function ExportNotesReview() {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  const includeDescription = useExportStore((state) => state.includeDescription);
  const selectedNoteIds = useExportStore((state) => state.selectedNoteIds);
  const reviewNotes = useExportStore((state) => state.reviewNotes);
  if (project === null) return null;
  const description = activePerspective(project.content)?.description ?? null;
  const notes = exportableNotes(project.content, activeCanvas(project.content));
  if (description === null && notes.length === 0) return null;
  return (
    <details className={styles.details}>
      <summary>{t("perspectives.exportNotes")}</summary>
      <p className={styles.hint}>{t("perspectives.reviewHint")}</p>
      {description === null ? null : (
        <div className={styles.note}>
          <Checkbox
            label={t("perspectives.exportDescription")}
            checked={includeDescription}
            onCheckedChange={(checked) => {
              reviewNotes(checked, selectedNoteIds);
            }}
          />
          <p className={styles.text}>{description}</p>
        </div>
      )}
      {notes.map((note) => (
        <div key={note.id} className={styles.note}>
          <Checkbox
            label={noteTargetLabel(note.target)}
            checked={selectedNoteIds.includes(note.id)}
            onCheckedChange={(checked) => {
              reviewNotes(
                includeDescription,
                checked
                  ? [...selectedNoteIds, note.id]
                  : selectedNoteIds.filter((id) => id !== note.id),
              );
            }}
          />
          <p className={styles.text}>{note.text}</p>
        </div>
      ))}
    </details>
  );
}
