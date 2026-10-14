import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { AppInfo } from "@/shared/contracts";

import { getAppInfo } from "./appInfo";

export type AppInfoState =
  | { status: "loading" }
  | { status: "ready"; info: AppInfo }
  /** The frontend runs outside Tauri (plain browser) or the command failed. */
  | { status: "unavailable" };

export function useAppInfo(): AppInfoState {
  const [state, setState] = useState<AppInfoState>(() =>
    isTauri() ? { status: "loading" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (state.status !== "loading") {
      return;
    }
    let isCancelled = false;

    getAppInfo()
      .then((info) => {
        if (!isCancelled) {
          setState({ status: "ready", info });
        }
      })
      .catch((error: unknown) => {
        console.warn("Could not read application info", error);
        if (!isCancelled) {
          setState({ status: "unavailable" });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [state.status]);

  return state;
}
