import { useId } from "react";

import { useCanvasUiStore } from "@/features/canvas/canvasUiStore";
import type { ModuleSectionView, RunsSectionView } from "@/features/schema/moduleDetailsView";

import { DefinitionSection } from "./DefinitionSection";
import { ColumnsTable } from "./InspectorSections";
import styles from "./ModuleSections.module.css";

export function ModuleSection({
  section,
  moduleKey,
  onShowAccessReport,
}: {
  section: ModuleSectionView;
  moduleKey: string;
  onShowAccessReport: () => void;
}) {
  const headingId = useId();
  if (section.kind === "definition")
    return <DefinitionSection section={section} onShowAccessReport={onShowAccessReport} />;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h4 id={headingId} className={styles.title}>
        {section.title}
      </h4>
      {section.kind === "parameters" ? (
        <>
          {section.emptyText === null ? (
            <table className={styles.parameters}>
              <thead>
                <tr>
                  <th scope="col">{section.headers.name}</th>
                  <th scope="col">{section.headers.type}</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item) => (
                  <tr key={item.name}>
                    <td>
                      <code>{item.name}</code>
                      {item.badges.map((badge) => (
                        <span key={badge} className={styles.badge}>
                          {badge}
                        </span>
                      ))}
                    </td>
                    <td>
                      <code>{item.type}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={styles.note}>{section.emptyText}</p>
          )}
          {section.note === null ? null : <p className={styles.footnote}>{section.note}</p>}
          {section.tracking === undefined ? null : (
            <p className={styles.footnote}>
              <strong>
                {section.tracking.title}: {section.tracking.label}.
              </strong>{" "}
              {section.tracking.explanation}
            </p>
          )}
        </>
      ) : section.kind === "returns" ? (
        <>
          {section.emptyText === null ? (
            section.columns === null ? (
              <p className={styles.note}>
                <code>{section.scalarType}</code>
              </p>
            ) : (
              <ColumnsTable
                section={section.columns}
                entityKey={moduleKey}
                onShowAccessReport={onShowAccessReport}
              />
            )
          ) : (
            <p className={styles.note}>{section.emptyText}</p>
          )}
        </>
      ) : (
        <RunsSection section={section} />
      )}
    </section>
  );
}

function RunsSection({ section }: { section: RunsSectionView }) {
  const focusEntity = useCanvasUiStore((state) => state.focusEntity);
  const openInspector = useCanvasUiStore((state) => state.openInspector);
  const { parent } = section;
  return (
    <>
      <p className={styles.note}>
        {parent.key === null ? (
          <code>{parent.label}</code>
        ) : (
          <button
            type="button"
            className={styles.link}
            aria-label={parent.goLabel}
            onClick={() => {
              if (parent.key !== null) {
                focusEntity(parent.key);
                openInspector({ focus: true });
              }
            }}
          >
            <code>{parent.label}</code>
          </button>
        )}
        {parent.stateLabel === null ? null : <> · {parent.stateLabel}</>}
      </p>
      {section.badges.length === 0 ? null : (
        <div className={styles.badges}>
          {section.badges.map((badge) => (
            <span key={badge} className={styles.badge}>
              {badge}
            </span>
          ))}
        </div>
      )}
      {section.emptyText === null ? (
        <ul className={styles.events}>
          {section.events.map((event, index) => (
            <li key={index}>
              {event.parts.map((part, partIndex) =>
                part.kind === "text" ? part.text : <code key={partIndex}>{part.value}</code>,
              )}
              {event.order === null ? null : <span className={styles.badge}>{event.order}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>{section.emptyText}</p>
      )}
      {section.notes.map((note) => (
        <p className={styles.footnote} key={note}>
          {note}
        </p>
      ))}
    </>
  );
}
