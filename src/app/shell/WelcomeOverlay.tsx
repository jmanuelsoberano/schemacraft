import { FileText } from "lucide-react";

import { ActionButton } from "@/app/actions/ActionButton";
import type { ActionsById } from "@/app/actions/action";
import { Logo } from "@/app/brand/Logo";
import { usePreferencesStore } from "@/features/preferences/preferencesStore";
import { projectDirectory, projectDisplayName } from "@/features/project/projectPaths";
import { useProjectStore } from "@/features/project/projectStore";
import { useI18n } from "@/shared/i18n/useI18n";

import styles from "./WelcomeOverlay.module.css";

interface WelcomeOverlayProps {
  actions: ActionsById;
}

/** Empty-canvas state: the two ways to get a diagram on screen, plus the recent projects. */
export function WelcomeOverlay({ actions }: WelcomeOverlayProps) {
  const { t } = useI18n();
  const recentProjects = usePreferencesStore((state) => state.recentProjects);
  const openProject = useProjectStore((state) => state.openProject);

  return (
    <div className={styles.overlay}>
      <section className={styles.card} aria-labelledby="welcome-title">
        <Logo size={56} className={styles.logo} />
        <h1 id="welcome-title" className={styles.title}>
          {t("welcome.title")}
        </h1>
        <p className={styles.description}>{t("welcome.description")}</p>
        <div className={styles.actions}>
          <ActionButton
            action={actions["project.connect"]}
            labelKey="welcome.connect"
            variant="primary"
            size="md"
          />
          <ActionButton
            action={actions["project.openProject"]}
            labelKey="welcome.openProject"
            variant="secondary"
            size="md"
          />
        </div>
        {recentProjects.length > 0 ? (
          <nav className={styles.recent} aria-labelledby="welcome-recent-title">
            <h2 id="welcome-recent-title" className={styles.recentTitle}>
              {t("welcome.recent.title")}
            </h2>
            <ul className={styles.recentList}>
              {recentProjects.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    title={entry.path}
                    aria-label={t("welcome.recent.open", { name: projectDisplayName(entry.path) })}
                    onClick={() => {
                      openProject(entry.path);
                    }}
                  >
                    <FileText className={styles.recentIcon} aria-hidden="true" />
                    <span className={styles.recentName}>{projectDisplayName(entry.path)}</span>
                    <span className={styles.recentPath}>{projectDirectory(entry.path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
