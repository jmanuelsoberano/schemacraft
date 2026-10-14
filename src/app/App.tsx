import { Tooltip } from "radix-ui";

import { useDocumentLanguage } from "@/shared/i18n/useDocumentLanguage";
import { useThemeSynchronization } from "@/shared/settings/useThemeSynchronization";

import { AppShell } from "./shell/AppShell";

export function App() {
  useThemeSynchronization();
  useDocumentLanguage();

  return (
    <Tooltip.Provider delayDuration={450} skipDelayDuration={250}>
      <AppShell />
    </Tooltip.Provider>
  );
}
