import { DropdownMenu } from "radix-ui";

import type { ActionId, ActionsById } from "@/app/actions/action";
import { formatShortcut, isApplePlatform } from "@/app/actions/shortcut";
import { useI18n } from "@/shared/i18n/useI18n";
import { IconButton } from "@/shared/ui/IconButton";
import { Kbd } from "@/shared/ui/Kbd";
import menuStyles from "@/shared/ui/RadioMenu.module.css";

interface LayoutMenuProps {
  actions: ActionsById;
}

const LAYOUT_ACTIONS: readonly ActionId[] = [
  "diagram.layoutLayered",
  "diagram.layoutLayeredHorizontal",
  "diagram.layoutOrganic",
  "diagram.layoutRadial",
];

/** Toolbar menu listing the automatic layouts; the button itself repeats the last one. */
export function LayoutMenu({ actions }: LayoutMenuProps) {
  const { t } = useI18n();
  const autoLayout = actions["diagram.autoLayout"];
  const applePlatform = isApplePlatform();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          label={t(autoLayout.labelKey)}
          icon={autoLayout.icon}
          shortcutHint={
            autoLayout.shortcut ? formatShortcut(autoLayout.shortcut, applePlatform) : undefined
          }
          description={autoLayout.isAvailable ? undefined : t("canvas.layout.needsProject")}
          disabled={!autoLayout.isAvailable}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={menuStyles.content}
        >
          <DropdownMenu.Label className={menuStyles.label}>
            {t("canvas.layout.menu")}
          </DropdownMenu.Label>
          {LAYOUT_ACTIONS.map((id) => {
            const action = actions[id];
            return (
              <DropdownMenu.Item
                key={id}
                className={menuStyles.item}
                disabled={!action.isAvailable}
                onSelect={action.run}
              >
                <span className={menuStyles.indicator} />
                <action.icon className={menuStyles.icon} aria-hidden="true" />
                {t(action.labelKey)}
                {action.shortcut ? (
                  <Kbd>{formatShortcut(action.shortcut, applePlatform)}</Kbd>
                ) : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
