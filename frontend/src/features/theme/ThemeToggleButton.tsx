import React from "react";
import { Button, Tooltip } from "antd";
import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useThemeMode } from "./ThemeProvider";
import styles from "./theme.module.css";

export function ThemeToggleButton() {
  const { mode, toggleMode } = useThemeMode();
  const isDark = mode === "dark";

  return (
    <Tooltip title={isDark ? "Включить светлую тему" : "Включить тёмную тему"}>
      <Button
        aria-label="Тёмная тема"
        aria-pressed={isDark}
        className={`${styles.themeToggle} app-header-control`}
        data-theme-toggle="true"
        icon={isDark ? <SunOutlined aria-hidden="true" /> : <MoonOutlined aria-hidden="true" />}
        onClick={toggleMode}
        htmlType="button"
      />
    </Tooltip>
  );
}
