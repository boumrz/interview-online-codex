import React, { useEffect, useState } from "react";
import { Button, Dropdown } from "antd";
import { DownloadOutlined, FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import styles from "./RoomCanvasToolbar.module.css";

const SAVING = "Сохранение…";
const SAVED = "Сохранено";
const SAVE_CONFIRMATION_DELAY_MS = 600;

type ToolbarProps<NativeFormat extends string> = {
  expanded: boolean;
  onToggleExpanded(): void;
  color: string | null;
  onApplyColor?: () => void;
  canDownload: boolean;
  nativeFormat: NativeFormat;
  onDownload(format: NativeFormat | "png" | "svg"): void;
  status: string;
  error: boolean;
  children?: React.ReactNode;
};

export function RoomCanvasToolbar<NativeFormat extends "drawio" | "excalidraw">({
  expanded, onToggleExpanded, color, onApplyColor, canDownload, nativeFormat, onDownload,
  status, error, children,
}: ToolbarProps<NativeFormat>) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (!canDownload) setMenuOpen(false); }, [canDownload]);
  const saving = !error && status === SAVING;
  const saved = !error && status === SAVED;
  const [showSaving, setShowSaving] = useState(saving);
  useEffect(() => {
    if (!saved) {
      setShowSaving(saving);
      return;
    }
    if (!showSaving) return;
    // Group rapid acknowledgements into one visible confirmation after the last edit.
    const timeout = window.setTimeout(() => setShowSaving(false), SAVE_CONFIRMATION_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [saving, saved, showSaving]);
  const formats = ["png", "svg", nativeFormat] as const;
  const expandLabel = expanded ? "Вернуться в комнату" : "На весь экран";

  return <div className={styles.toolbar} role="group" aria-label="Действия с холстом">
    <div className={styles.actions}>
      {color && <Button type="text" onClick={onApplyColor} disabled={!onApplyColor}
        data-testid="room-drawing-color" data-color={color}
        aria-label={`Закреплённый цвет (${color})`} title="Цвет, закреплённый за вами при входе в комнату. Применить к новым объектам."
        icon={<span aria-hidden="true" className={styles.swatch} style={{ backgroundColor: color }} />}>
        <span className={styles.actionLabel}>Закреплённый цвет</span>
      </Button>}
      <Dropdown
        trigger={["click"]} placement="bottomLeft" transitionName="" autoFocus destroyOnHidden
        disabled={!canDownload} open={canDownload && menuOpen} onOpenChange={setMenuOpen}
        getPopupContainer={trigger => trigger.parentElement ?? trigger}
        menu={{
          "aria-label": "Формат скачивания",
          items: formats.map(format => ({
            key: format,
            label: format === nativeFormat ? `.${format}` : format.toUpperCase(),
            onClick: () => onDownload(format),
          })),
        }}
      >
        <Button disabled={!canDownload} aria-label="Скачать" title="Выбрать формат скачивания"
          aria-haspopup="menu" aria-expanded={canDownload && menuOpen} icon={<DownloadOutlined aria-hidden="true" />}>
          <span className={styles.actionLabel}>Скачать</span>
        </Button>
      </Dropdown>
      {(saving || saved) && <span role="status" aria-busy={saving} className={styles.saveStatus}>
        {saving || showSaving ? SAVING : SAVED}
      </span>}
    </div>
    <Button className={styles.expand} type="text" title={expandLabel} aria-label={expandLabel}
      aria-expanded={expanded} onClick={onToggleExpanded}
      icon={expanded ? <FullscreenExitOutlined aria-hidden="true" /> : <FullscreenOutlined aria-hidden="true" />}>
      <span className={styles.expandLabel}>{expandLabel}</span>
    </Button>
    {!saving && !saved && <div className={styles.feedback}>
      <span role="status" className={error ? styles.error : styles.status}>{status}</span>
      {children}
    </div>}
  </div>;
}
