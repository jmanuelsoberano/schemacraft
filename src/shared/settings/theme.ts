export type ResolvedTheme = "light" | "dark";

export type ThemePreference = ResolvedTheme | "system";

export const DARK_SCHEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Turns the user's preference into the theme to render, following the OS when asked to. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}
