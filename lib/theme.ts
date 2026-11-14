export const THEME_KEY = "fourfivex.theme";
export const DARK_SCHEME = "(prefers-color-scheme: dark)";
export const THEME_COLORS = { light: "#ffffff", dark: "#080808" };

export type Theme = "system" | "light" | "dark";

export function themeFrom(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
