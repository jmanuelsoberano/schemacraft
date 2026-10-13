import { create } from "zustand";

import type {
  Preferences,
  RecentConnection,
  RecentProject,
  SavedConnection,
} from "@/shared/contracts";
import { getPreferencesBackend } from "@/shared/ipc/preferencesBackend";

interface PreferencesState {
  recentConnections: readonly RecentConnection[];
  recentProjects: readonly RecentProject[];
  isLoaded: boolean;
  /** Reads the preferences from the user's profile; called once when the window opens. */
  load: () => Promise<void>;
  rememberConnection: (connection: SavedConnection) => Promise<void>;
  forgetConnection: (connection: SavedConnection) => Promise<void>;
  rememberProject: (path: string) => Promise<void>;
  forgetProject: (path: string) => Promise<void>;
}

/**
 * Connection history and recent projects. The Rust side owns the file; this store mirrors it
 * and applies every answer it returns. Failures are logged, never shown: losing a history
 * entry must not interrupt the user's work.
 */
export const usePreferencesStore = create<PreferencesState>()((set) => {
  const apply = (preferences: Preferences) => {
    set({
      recentConnections: preferences.recentConnections,
      recentProjects: preferences.recentProjects,
      isLoaded: true,
    });
  };

  const run = async (
    description: string,
    operation: (backend: Awaited<ReturnType<typeof getPreferencesBackend>>) => Promise<Preferences>,
  ): Promise<void> => {
    try {
      apply(await operation(await getPreferencesBackend()));
    } catch (error: unknown) {
      console.warn(`Preferences could not be updated (${description})`, error);
    }
  };

  return {
    recentConnections: [],
    recentProjects: [],
    isLoaded: false,
    load: () => run("load", (backend) => backend.readPreferences()),
    rememberConnection: (connection) =>
      run("remember connection", (backend) => backend.rememberConnection(connection)),
    forgetConnection: (connection) =>
      run("forget connection", (backend) => backend.forgetConnection(connection)),
    rememberProject: (path) => run("remember project", (backend) => backend.rememberProject(path)),
    forgetProject: (path) => run("forget project", (backend) => backend.forgetProject(path)),
  };
});
