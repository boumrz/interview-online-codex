import assert from "node:assert/strict";
import test from "node:test";
import { theme } from "antd";
import {
  THEME_MODES,
  getAntThemeConfig,
  getThemeCssVariables,
  resolveStoredTheme,
} from "../../src/features/theme/themeTokens.ts";

test("theme contract exposes the same semantic roles for light and dark", () => {
  assert.deepEqual(THEME_MODES, ["light", "dark"]);

  for (const mode of THEME_MODES) {
    const variables = getThemeCssVariables(mode);
    for (const key of [
      "--app-bg",
      "--app-surface",
      "--app-surface-soft",
      "--app-border",
      "--app-control-border",
      "--app-text",
      "--app-muted",
      "--app-primary",
      "--app-primary-hover",
      "--app-primary-active",
      "--app-on-primary",
      "--app-selected-bg",
      "--app-selected-hover",
      "--app-selected-text",
      "--app-focus",
      "--font-base",
      "--font-code",
    ]) {
      assert.ok(variables[key], `${mode} theme is missing ${key}`);
    }
    const config = getAntThemeConfig(mode);
    assert.ok(Number(config.token?.borderRadius) >= 8, `${mode} theme base radius must be at least 8px`);
    assert.ok(Number(config.token?.borderRadiusXS) >= 8, `${mode} theme XS radius must be at least 8px`);
    assert.ok(Number(config.token?.borderRadiusSM) >= 8, `${mode} theme SM radius must be at least 8px`);
    assert.ok(Number(config.components?.Button?.borderRadius) >= 8, `${mode} button radius must be at least 8px`);
  }
});

test("light tokens match the supplied design roles", () => {
  const variables = getThemeCssVariables("light");
  const config = getAntThemeConfig("light");

  assert.equal(variables["--app-primary"], "#642eff");
  assert.equal(variables["--app-bg"], "#f3f5fb");
  assert.equal(variables["--app-text"], "#1d2129");
  assert.equal(config.token?.colorPrimary, "#642eff");
  assert.equal(config.token?.colorText, "#1d2129");
  assert.equal(config.token?.controlHeight, 36);
  assert.equal(config.token?.fontSize, 15);
  assert.equal(config.token?.borderRadius, 8);
  assert.equal(config, getAntThemeConfig("light"));
  const computed = theme.getDesignToken(config);
  assert.equal(computed.colorPrimary, "#642eff");
  assert.equal(computed.colorBgContainer, "#ffffff");
  assert.equal(config.algorithm instanceof Array, true);
});

test("dark tokens preserve the product's existing dark colors", () => {
  const variables = getThemeCssVariables("dark");
  const config = getAntThemeConfig("dark");

  assert.equal(variables["--app-bg"], "#0f1115");
  assert.equal(variables["--app-surface"], "#11151c");
  assert.equal(variables["--app-surface-soft"], "#141921");
  assert.equal(variables["--app-primary"], "#3b82f6");
  assert.equal(variables["--app-primary-text"], "#8ab4ff");
  assert.equal(variables["--app-text"], "#f3f5f7");
  assert.equal(config.token?.colorPrimary, "#3b82f6");
  assert.equal(config.token?.colorTextLightSolid, "#ffffff");
  assert.equal(config, getAntThemeConfig("dark"));
  const computed = theme.getDesignToken(config);
  assert.equal(computed.colorPrimary, "#3b82f6");
  assert.equal(computed.colorBgContainer, "#11151c");
  assert.equal(computed.colorTextLightSolid, "#ffffff");
  assert.equal(config.algorithm instanceof Array, true);
});

test("theme storage accepts explicit light and dark and otherwise follows system appearance", () => {
  assert.equal(resolveStoredTheme("dark"), "dark");
  assert.equal(resolveStoredTheme("light"), "light");
  assert.equal(resolveStoredTheme("system"), "light");
  assert.equal(resolveStoredTheme(null), "light");
  assert.equal(resolveStoredTheme(null, "dark"), "dark");
  assert.equal(resolveStoredTheme("system", "dark"), "dark");
  assert.equal(resolveStoredTheme("light", "dark"), "light");
  assert.equal(resolveStoredTheme("dark", "light"), "dark");
});

test("editor surfaces and control outlines follow the selected appearance", () => {
  const light = getThemeCssVariables("light");
  const dark = getThemeCssVariables("dark");
  assert.equal(light["--app-editor-bg"], light["--app-surface"]);
  assert.equal(light["--app-editor-text"], light["--app-text"]);
  assert.equal(light["--app-control-border"], "#bcc2ce");
  assert.equal(dark["--app-editor-bg"], dark["--app-surface"]);
  for (const mode of THEME_MODES) {
    const config = getAntThemeConfig(mode);
    assert.equal(config.components?.Button?.defaultShadow, "none");
    assert.equal(config.components?.Checkbox?.borderRadiusSM, 4);
  }
});

test("dialog title and body use one theme surface in both appearances", () => {
  for (const mode of THEME_MODES) {
    const modal = getAntThemeConfig(mode).components?.Modal;
    assert.equal(modal?.headerBg, modal?.contentBg, `${mode}: dialog header must share the body surface`);
  }
});
