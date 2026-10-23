import { PanelsTopLeft } from "lucide-react";

import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";
import { IconButton } from "@/shared/ui/IconButton";
import { Select } from "@/shared/ui/Select";

import { activePerspective } from "./perspectiveState";
import styles from "./PerspectivesPanel.module.css";

/** Compact everyday navigation; the shell owns the management surface. */
export function PerspectiveSwitcher({ onManage }: { onManage?: () => void }) {
  const { t } = useI18n();
  const project = useProjectStore((state) => state.project);
  if (project === null) return null;
  const active = activePerspective(project.content);
  return (
    <div className={styles.switcher}>
      <Select
        label={t("perspectives.title")}
        value={active === undefined ? "general" : `map:${active.id}`}
        options={[
          { value: "general", label: t("perspectives.general") },
          ...(project.content.perspectives ?? []).map((item) => ({
            value: `map:${item.id}`,
            label: item.name,
          })),
        ]}
        onValueChange={(value) => {
          useProjectStore.getState().selectPerspective(value === "general" ? null : value.slice(4));
        }}
        placeholder={t("perspectives.general")}
      />
      {onManage === undefined ? null : (
        <IconButton label={t("perspectives.title")} icon={PanelsTopLeft} onClick={onManage} />
      )}
    </div>
  );
}
