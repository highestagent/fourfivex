"use client";

import { useSyncExternalStore } from "react";
import { DARK_SCHEME, THEME_COLORS, THEME_KEY, themeFrom, type Theme } from "@/lib/theme";
import { Select } from "./Select";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
const THEME_CHANGE = "fourfivex:theme-change";

function getTheme(): Theme {
  return themeFrom(document.documentElement.getAttribute("data-theme"));
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;

  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_SCHEME).matches);
  const color = dark ? THEME_COLORS.dark : THEME_COLORS.light;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = color;
  }
}

function subscribe(listener: () => void) {
  const system = window.matchMedia(DARK_SCHEME);
  const onSystem = () => applyTheme(getTheme());
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    applyTheme(themeFrom(event.newValue));
    listener();
  };

  window.addEventListener(THEME_CHANGE, listener);
  window.addEventListener("storage", onStorage);
  system.addEventListener("change", onSystem);
  onSystem();

  return () => {
    window.removeEventListener(THEME_CHANGE, listener);
    window.removeEventListener("storage", onStorage);
    system.removeEventListener("change", onSystem);
  };
}

function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    if (theme === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The override still applies for this visit when storage is unavailable.
  }
  window.dispatchEvent(new Event(THEME_CHANGE));
}

const serverTheme = (): Theme => "system";

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getTheme, serverTheme);

  return (
    <Select
      label={`Appearance: ${OPTIONS.find(({ value }) => value === theme)?.label}`}
      triggerLabel="Appearance"
      value={theme}
      options={OPTIONS}
      onValueChange={setTheme}
      className="min-h-11 rounded-lg px-2 text-xs font-medium text-ink-2 hover:text-ink"
      pickerTitle="Choose a theme"
    />
  );
}
