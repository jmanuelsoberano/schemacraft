import { ActionButton } from "@/app/actions/ActionButton";
import type { ActionsById } from "@/app/actions/action";
import { Logo } from "@/app/brand/Logo";
import { useI18n } from "@/shared/i18n/useI18n";

import styles from "./WelcomeOverlay.module.css";

interface WelcomeOverlayProps {
  actions: ActionsById;
}

/** Empty-canvas state that explains the two ways to get a diagram on screen. */
export function WelcomeOverlay({ actions }: WelcomeOverlayProps) {
  const { t } = useI18n();

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
      </section>
    </div>
  );
}
