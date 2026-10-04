import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { App as AntDesignApp, ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import { getAntThemeConfig, resolveStoredTheme, THEME_STORAGE_KEY, type ThemeMode } from "./themeTokens";

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredPreference(): ThemeMode | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function readSystemTheme(): ThemeMode {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyDocumentTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

export function ThemeProvider({ children }: React.PropsWithChildren) {
  const preferenceRef = useRef(readStoredPreference());
  const [mode, setModeState] = useState<ThemeMode>(() => resolveStoredTheme(preferenceRef.current, readSystemTheme()));

  const setMode = useCallback((nextMode: ThemeMode) => {
    preferenceRef.current = nextMode;
    setModeState(nextMode);
    applyDocumentTheme(nextMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // The current tab still follows the user's choice when storage is unavailable.
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "light" ? "dark" : "light");
  }, [mode, setMode]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateResolvedTheme = () => {
      const nextMode = resolveStoredTheme(preferenceRef.current, media.matches ? "dark" : "light");
      setModeState(nextMode);
      applyDocumentTheme(nextMode);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      const saved = event.key === null ? null : event.newValue;
      preferenceRef.current = saved === "light" || saved === "dark" ? saved : null;
      updateResolvedTheme();
    };
    updateResolvedTheme();
    media.addEventListener("change", updateResolvedTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", updateResolvedTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo(() => ({ mode, setMode, toggleMode }), [mode, setMode, toggleMode]);
  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider componentSize="medium" locale={ruRU} theme={getAntThemeConfig(mode)}>
        <AntDesignApp>{children}</AntDesignApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useThemeMode() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useThemeMode must be used inside ThemeProvider");
  return value;
}
