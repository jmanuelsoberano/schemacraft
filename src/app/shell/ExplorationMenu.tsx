import { ChevronDown, Compass } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import type { ActionId, ActionsById } from "@/app/actions/action";
import { useI18n } from "@/shared/i18n/useI18n";
import { Button } from "@/shared/ui/Button";
import styles from "@/shared/ui/RadioMenu.module.css";

const EXPLORATION_ACTIONS: ActionId[] = [
  "project.compareProjects",
  "view.dependencies",
  "view.perspectives",
];

/** A single discoverable entry point keeps advanced workflows out of the everyday toolbar. */
export function ExplorationMenu({ actions }: { actions: ActionsById }) {
  const { t } = useI18n();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button>
          <Compass size={14} aria-hidden="true" />
          {t("menu.exploration")}
          <ChevronDown size={12} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} align="end" sideOffset={6}>
          {EXPLORATION_ACTIONS.map((id) => {
            const action = actions[id];
            return (
              <DropdownMenu.Item
                key={id}
                className={styles.item}
                disabled={!action.isAvailable}
                onSelect={action.run}
              >
                <action.icon size={14} aria-hidden="true" />
                {t(action.labelKey)}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
