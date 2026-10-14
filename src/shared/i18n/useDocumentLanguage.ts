import { useEffect } from "react";

import { useSettingsStore } from "@/shared/settings/settingsStore";

/** Keeps the document language in sync with the selected locale for assistive technology. */
export function useDocumentLanguage(): void {
  const locale = useSettingsStore((state) => state.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
}
