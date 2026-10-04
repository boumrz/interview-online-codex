import { theme } from "antd";
import type { ThemeConfig } from "antd";
import type { MappingAlgorithm } from "antd/es/theme/interface";

export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_STORAGE_KEY = "interview-online:ui-theme";

const palette = {
  black: "#111418",
  white: "#ffffff",
  blue: { 50: "#eff5ff", 500: "#00a3f5" },
  green: { 100: "#eefef0", 200: "#76f9af", 300: "#00d664", 400: "#09ae51", 500: "#06743a" },
  orange: { 100: "#fffbea", 200: "#fef2c5", 300: "#ffd25c", 400: "#fbb500", 500: "#eea002" },
  red: { 100: "#fff2f1", 200: "#fe7284", 300: "#f42a4b", 400: "#cb0b38", 500: "#b30c33" },
  gray: {
    50: "#fafafc", 100: "#f3f5fb", 150: "#eaecf6", 200: "#e0e1e8", 300: "#ccced9",
    400: "#bec0ce", 500: "#9298ab", 600: "#838c9e", 700: "#616a7b", 800: "#4b4e58",
    850: "#383e4d", 900: "#272b36", 950: "#1f242e", 1000: "#1d2129",
  },
  brand: {
    25: "#f7f6fe", 50: "#f2f1ff", 75: "#ecebff", 100: "#e2e0ff", 200: "#d6d3fa",
    300: "#b8b3fc", 400: "#766cf9", 500: "#642eff", 600: "#460ceb", 700: "#2c21ca",
    800: "#251ba7", 900: "#191272",
  },
  neutral: {
    100: "#fafafc", 200: "#ebeff9", 300: "#e4e6f1", 400: "#dcddeb", 500: "#b6b9ce",
    600: "#a0a3bd", 700: "#898da9", 800: "#6b7094", 900: "#3c4166",
  },
} as const;

const typography = {
  "--font-base": '"IBM Plex Sans", "Segoe UI", sans-serif',
  "--font-code": '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace',
} as const;

const dimensions = {
  "--container-width": "1366px",
  "--header-height": "48px",
  "--offset-tiny": "2px",
  "--offset-xxs": "4px",
  "--offset-xs": "8px",
  "--offset-sm": "12px",
  "--offset-md": "16px",
  "--offset-lg": "20px",
  "--offset-xl": "24px",
  "--offset-xxl": "28px",
  "--offset-huge": "32px",
  "--offset-jumbo": "40px",
  "--size-tiny": "2px",
  "--size-xxs": "4px",
  "--size-xs": "8px",
  "--size-sm": "12px",
  "--size-md": "16px",
  "--size-lg": "20px",
  "--size-xl": "24px",
  "--size-xxl": "28px",
  "--size-huge": "32px",
  "--size-jumbo": "40px",
} as const;

const lightRoles = {
  "--app-bg": palette.gray[100],
  "--app-surface": palette.white,
  "--app-surface-soft": palette.gray[50],
  "--app-surface-elevated": palette.white,
  "--app-border": palette.gray[200],
  "--app-control-border": "#bcc2ce",
  "--app-text": palette.gray[1000],
  "--app-text-heading": palette.gray[1000],
  "--app-muted": palette.gray[700],
  "--app-tertiary": palette.gray[500],
  "--app-disabled": palette.gray[500],
  "--app-primary": palette.brand[500],
  "--app-primary-hover": palette.brand[600],
  "--app-primary-active": palette.brand[700],
  "--app-on-primary": palette.white,
  "--app-primary-text": palette.brand[600],
  "--app-primary-text-hover": palette.brand[700],
  "--app-selected-bg": palette.brand[50],
  "--app-selected-hover": palette.brand[75],
  "--app-selected-text": palette.brand[600],
  "--app-focus": palette.brand[500],
  "--app-focus-ring": "rgba(100, 46, 255, 0.18)",
  "--app-success": palette.green[500],
  "--app-success-bg": palette.green[100],
  "--app-warning": palette.gray[900],
  "--app-warning-accent": palette.orange[500],
  "--app-warning-bg": palette.orange[100],
  "--app-error": palette.red[500],
  "--app-error-fill": palette.red[400],
  "--app-error-hover": palette.red[500],
  "--app-error-bg": palette.red[100],
  "--app-on-error": palette.white,
  "--app-info": palette.gray[900],
  "--app-info-accent": palette.blue[500],
  "--app-info-bg": palette.blue[50],
  "--app-tooltip-bg": palette.gray[950],
  "--app-tooltip-text": palette.white,
  "--app-mask": "rgba(17, 20, 24, 0.45)",
  "--app-neutral-hover": palette.gray[150],
  "--app-neutral-active": palette.gray[150],
  "--app-disabled-bg": palette.gray[100],
  "--app-editor-bg": palette.white,
  "--app-editor-text": palette.gray[1000],
  "--app-editor-muted": palette.gray[700],
  "--app-editor-active-line": palette.gray[50],
  "--app-editor-selection": palette.brand[100],
} as const;

const darkRoles = {
  "--app-bg": "#0f1115",
  "--app-surface": "#11151c",
  "--app-surface-soft": "#141921",
  "--app-surface-elevated": "#141921",
  "--app-border": "#262b34",
  "--app-control-border": "#272b34",
  "--app-text": "#f3f5f7",
  "--app-text-heading": "#f3f5f7",
  "--app-muted": "#8b919b",
  "--app-tertiary": "#8d97a5",
  "--app-disabled": "#64748b",
  "--app-primary": "#3b82f6",
  "--app-primary-hover": "#60a5fa",
  "--app-primary-active": "#1d4ed8",
  "--app-on-primary": "#ffffff",
  "--app-primary-text": "#8ab4ff",
  "--app-primary-text-hover": "#dbeafe",
  "--app-selected-bg": "#10213a",
  "--app-selected-hover": "#1d3658",
  "--app-selected-text": "#dbeafe",
  "--app-focus": "#60a5fa",
  "--app-focus-ring": "rgba(96, 165, 250, 0.28)",
  "--app-success": "#6ee7b7",
  "--app-success-bg": "rgba(52, 211, 153, 0.1)",
  "--app-warning": "#f5c26b",
  "--app-warning-accent": "#ffaa4d",
  "--app-warning-bg": "rgba(125, 93, 33, 0.24)",
  "--app-error": "#fca5a5",
  "--app-error-fill": "#ef4444",
  "--app-error-hover": "#ff8484",
  "--app-error-bg": "rgba(239, 68, 68, 0.12)",
  "--app-on-error": "#ffffff",
  "--app-info": "#cbd5e1",
  "--app-info-accent": "#8ab4ff",
  "--app-info-bg": "#10213a",
  "--app-tooltip-bg": "#101318",
  "--app-tooltip-text": "#f3f5f7",
  "--app-mask": "rgba(15, 17, 21, 0.72)",
  "--app-neutral-hover": "#1b2738",
  "--app-neutral-active": "#2a3648",
  "--app-disabled-bg": "#151b25",
  "--app-editor-bg": "#11151c",
  "--app-editor-text": "#f3f5f7",
  "--app-editor-muted": "#8b919b",
  "--app-editor-active-line": "#141921",
  "--app-editor-selection": "#2d3b4f",
} as const;

const requiredVariables = [
  "--app-bg", "--app-surface", "--app-surface-soft", "--app-surface-elevated", "--app-border",
  "--app-control-border", "--app-text", "--app-text-heading", "--app-muted", "--app-tertiary",
  "--app-disabled", "--app-primary", "--app-primary-hover", "--app-primary-active", "--app-on-primary",
  "--app-primary-text", "--app-primary-text-hover", "--app-selected-bg", "--app-selected-hover",
  "--app-selected-text", "--app-focus", "--app-focus-ring", "--app-success", "--app-success-bg",
  "--app-warning", "--app-warning-accent", "--app-warning-bg", "--app-error", "--app-error-fill",
  "--app-error-hover", "--app-error-bg", "--app-on-error", "--app-info", "--app-info-accent",
  "--app-info-bg", "--app-tooltip-bg", "--app-tooltip-text", "--app-mask", "--app-neutral-hover",
  "--app-neutral-active", "--app-disabled-bg", "--app-editor-bg", "--app-editor-text",
  "--app-editor-muted", "--app-editor-active-line", "--app-editor-selection",
] as const;

function primitiveVariables(): Record<string, string> {
  const result: Record<string, string> = {
    "--black": palette.black,
    "--white": palette.white,
  };
  for (const [name, scale] of Object.entries(palette)) {
    if (typeof scale !== "object") continue;
    for (const [step, value] of Object.entries(scale)) {
      result[`--${name}-${step}`] = value;
    }
  }
  return result;
}

export function resolveStoredTheme(value: string | null | undefined, systemMode: ThemeMode = "light"): ThemeMode {
  return value === "dark" || value === "light" ? value : systemMode;
}

export function getThemeCssVariables(mode: ThemeMode): Readonly<Record<string, string>> {
  const roles = mode === "dark" ? darkRoles : lightRoles;
  const variables = {
    ...primitiveVariables(),
    ...dimensions,
    ...typography,
    ...roles,
    "--theme-mode": mode,
  };

  for (const key of requiredVariables) {
    if (!variables[key]) throw new Error(`Theme token ${key} is not defined for ${mode}`);
  }

  return variables;
}

function getTokenOverrides(mode: ThemeMode): NonNullable<ThemeConfig["token"]> {
  const colors = mode === "dark" ? darkRoles : lightRoles;
  return {
    colorPrimary: colors["--app-primary"],
    colorPrimaryHover: colors["--app-primary-hover"],
    colorPrimaryActive: colors["--app-primary-active"],
    colorPrimaryBg: colors["--app-selected-bg"],
    colorPrimaryBgHover: colors["--app-selected-hover"],
    colorPrimaryBorder: colors["--app-focus"],
    colorPrimaryText: colors["--app-primary-text"],
    colorPrimaryTextHover: colors["--app-primary-text-hover"],
    controlItemBgActive: colors["--app-selected-bg"],
    controlItemBgActiveHover: colors["--app-selected-hover"],
    colorText: colors["--app-text"],
    colorTextBase: colors["--app-text"],
    colorTextHeading: colors["--app-text-heading"],
    colorTextSecondary: colors["--app-muted"],
    colorTextDescription: colors["--app-muted"],
    colorTextPlaceholder: colors["--app-muted"],
    colorTextDisabled: colors["--app-disabled"],
    colorTextLightSolid: colors["--app-on-primary"],
    colorBgLayout: colors["--app-bg"],
    colorBgBase: colors["--app-bg"],
    colorBgContainer: colors["--app-surface"],
    colorBgElevated: colors["--app-surface-elevated"],
    colorBgContainerDisabled: colors["--app-disabled-bg"],
    colorBgMask: colors["--app-mask"],
    colorBgSpotlight: colors["--app-tooltip-bg"],
    colorBorder: colors["--app-control-border"],
    colorBorderSecondary: colors["--app-border"],
    colorSplit: colors["--app-border"],
    colorBorderBg: colors["--app-surface"],
    colorFill: colors["--app-neutral-active"],
    colorFillSecondary: colors["--app-neutral-hover"],
    colorFillTertiary: colors["--app-surface-soft"],
    colorFillQuaternary: colors["--app-surface-soft"],
    colorFillAlter: colors["--app-surface-soft"],
    colorFillContent: colors["--app-neutral-hover"],
    colorFillContentHover: colors["--app-neutral-active"],
    colorIcon: colors["--app-muted"],
    colorIconHover: colors["--app-text"],
    colorSuccess: colors["--app-success"],
    colorSuccessText: colors["--app-success"],
    colorSuccessBg: colors["--app-success-bg"],
    colorWarning: colors["--app-warning-accent"],
    colorWarningText: colors["--app-warning"],
    colorWarningBg: colors["--app-warning-bg"],
    colorError: colors["--app-error-fill"],
    colorErrorText: colors["--app-error"],
    colorErrorBg: colors["--app-error-bg"],
    colorInfo: colors["--app-info-accent"],
    colorInfoText: colors["--app-info"],
    colorInfoBg: colors["--app-info-bg"],
    colorLink: colors["--app-primary-text"],
    colorLinkHover: colors["--app-primary-text-hover"],
    colorLinkActive: colors["--app-primary-active"],
    controlOutline: colors["--app-focus-ring"],
    fontFamily: typography["--font-base"],
    fontFamilyCode: typography["--font-code"],
    fontSize: 15,
    fontSizeSM: 13,
    fontSizeLG: 17,
    fontSizeXL: 20,
    fontSizeHeading1: 24,
    fontSizeHeading2: 20,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontSizeHeading5: 15,
    lineHeight: 24 / 15,
    lineHeightSM: 20 / 13,
    lineHeightLG: 26 / 17,
    lineHeightHeading1: 32 / 24,
    lineHeightHeading2: 28 / 20,
    lineHeightHeading3: 24 / 18,
    lineHeightHeading4: 24 / 16,
    lineHeightHeading5: 24 / 15,
    fontWeightStrong: 600,
    sizeStep: 4,
    sizeUnit: 4,
    controlHeight: 36,
    controlHeightSM: 28,
    controlHeightLG: 40,
    controlHeightXS: 16,
    controlInteractiveSize: 16,
    borderRadius: 8,
    borderRadiusXS: 8,
    borderRadiusSM: 8,
    borderRadiusLG: 12,
    lineWidth: 1,
    lineWidthBold: 2,
    lineWidthFocus: 2,
    motionDurationFast: "0.1s",
    motionDurationMid: "0.16s",
    motionDurationSlow: "0.2s",
    paddingXXS: 4,
    paddingXS: 8,
    paddingSM: 12,
    padding: 16,
    paddingMD: 20,
    paddingLG: 24,
    paddingXL: 32,
    marginXXS: 4,
    marginXS: 8,
    marginSM: 12,
    margin: 16,
    marginMD: 20,
    marginLG: 24,
    marginXL: 32,
    marginXXL: 40,
  };
}

function createAntThemeConfig(mode: ThemeMode): ThemeConfig {
  const baseAlgorithm = mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;
  const fixedModeRoles: MappingAlgorithm = (seed, derived) => ({
    ...baseAlgorithm(seed, derived),
    ...getTokenOverrides(mode),
  });

  return {
    algorithm: [baseAlgorithm, fixedModeRoles],
    cssVar: { key: "interview-online" },
    hashed: true,
    token: getTokenOverrides(mode),
    components: {
      Button: {
        defaultShadow: "none",
        primaryShadow: "none",
        dangerShadow: "none",
        controlHeight: 36,
        controlHeightSM: 28,
        controlHeightLG: 40,
        borderRadius: 8,
      },
      Checkbox: { borderRadiusSM: 4 },
      Tabs: {
        itemSelectedColor: mode === "dark" ? darkRoles["--app-primary-text"] : lightRoles["--app-primary-text"],
        itemHoverColor: mode === "dark" ? darkRoles["--app-primary-text-hover"] : lightRoles["--app-primary-text-hover"],
        itemActiveColor: mode === "dark" ? darkRoles["--app-primary-active"] : lightRoles["--app-primary-active"],
        inkBarColor: mode === "dark" ? darkRoles["--app-primary-text"] : lightRoles["--app-primary-text"],
      },
      Modal: {
        contentBg: mode === "dark" ? darkRoles["--app-surface-elevated"] : lightRoles["--app-surface-elevated"],
        headerBg: mode === "dark" ? darkRoles["--app-surface-elevated"] : lightRoles["--app-surface-elevated"],
      },
      Tooltip: {
        colorBgSpotlight: mode === "dark" ? darkRoles["--app-tooltip-bg"] : lightRoles["--app-tooltip-bg"],
        colorTextLightSolid: mode === "dark" ? darkRoles["--app-tooltip-text"] : lightRoles["--app-tooltip-text"],
      },
    },
  };
}

const ANT_THEME_CONFIGS: Record<ThemeMode, ThemeConfig> = {
  light: createAntThemeConfig("light"),
  dark: createAntThemeConfig("dark"),
};

export function getAntThemeConfig(mode: ThemeMode): ThemeConfig {
  return ANT_THEME_CONFIGS[mode];
}

export function renderThemeCss(): string {
  const entries = THEME_MODES.map((mode) => {
    const selector = mode === "light" ? ":root, :root[data-theme=\"light\"]" : ":root[data-theme=\"dark\"]";
    const declarations = Object.entries(getThemeCssVariables(mode))
      .map(([name, value]) => `  ${name}: ${value};`)
      .join("\n");
    const scheme = mode === "dark" ? "dark" : "light";
    return `${selector} {\n${declarations}\n  color-scheme: ${scheme};\n}`;
  });

  return `/* Generated from src/features/theme/themeTokens.ts. Do not edit by hand. */\n${entries.join("\n\n")}\n`;
}
