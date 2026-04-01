import type { AppSettings, ThemePreference, WriteMode } from "./types";

const SETTINGS_KEY = "zoocute:settings";
const LEGACY_THEME_KEY = "zoocute:theme";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  writeMode: "readonly",
  pluginDirectory: null,
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isWriteMode(value: unknown): value is WriteMode {
  return value === "readonly" || value === "readwrite";
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        theme: isThemePreference(parsed.theme) ? parsed.theme : DEFAULT_APP_SETTINGS.theme,
        writeMode: isWriteMode(parsed.writeMode) ? parsed.writeMode : DEFAULT_APP_SETTINGS.writeMode,
        pluginDirectory:
          typeof parsed.pluginDirectory === "string" && parsed.pluginDirectory.trim().length > 0
            ? parsed.pluginDirectory
            : null,
      };
    }
  } catch {
    // ignore malformed data
  }

  const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
  return {
    ...DEFAULT_APP_SETTINGS,
    theme: legacyTheme === "light" || legacyTheme === "dark" ? legacyTheme : "system",
  };
}

export function saveAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (settings.theme === "light" || settings.theme === "dark") {
    localStorage.setItem(LEGACY_THEME_KEY, settings.theme);
  } else {
    localStorage.removeItem(LEGACY_THEME_KEY);
  }
}
