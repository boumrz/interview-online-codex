import React, { useId } from "react";
import { BorderOutlined, ClearOutlined, DeleteOutlined, EditOutlined, FontSizeOutlined, LineOutlined, PictureOutlined } from "@ant-design/icons";
import { StrokeWidthControl } from "./StrokeWidthControl";
import styles from "./WhiteboardTools.module.css";

function CircleIcon() { return <span aria-hidden="true" className={styles.circleIcon} />; }
function HandIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 6V4a1.5 1.5 0 0 1 3 0v8M14 6a1.5 1.5 0 0 1 3 0v6M17 8a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-3L3 13a1.5 1.5 0 0 1 2.5-1.5L8 14" />
  </svg>;
}

const tools = [
  { type: "selection", label: "Выделение", icon: HandIcon },
  { type: "freedraw", label: "Карандаш", icon: EditOutlined },
  { type: "line", label: "Линия", icon: LineOutlined },
  { type: "rectangle", label: "Прямоугольник", icon: BorderOutlined },
  { type: "ellipse", label: "Круг", icon: CircleIcon },
  { type: "text", label: "Текст", icon: FontSizeOutlined },
  { type: "eraser", label: "Ластик", icon: ClearOutlined },
] as const;

export type WhiteboardTool = typeof tools[number]["type"];

type Props = {
  canClear: boolean;
  importing: boolean;
  onImage(): void;
  onClear(): void;
  activeTool: string;
  color: string;
  strokeWidth?: number;
  onWidth(width: number): void;
  onSelect(tool: WhiteboardTool): void;
  onPointerSelect(): void;
  onColor(color: string): void;
};

export function WhiteboardTools({ activeTool, color, strokeWidth, onWidth, onSelect, onPointerSelect, onColor, canClear, onClear, importing, onImage }: Props) {
  const group = useId();
  return <div className={styles.bar} role="group" aria-label="Инструменты доски">
    {tools.map(({ type, label, icon: Icon }) => <label key={type} className={styles.tool} title={type === "selection" ? "Выделить и переместить объекты" : label}>
      <input type="radio" name={group} checked={activeTool === type} onChange={() => onSelect(type)}
        onClick={event => { if (event.detail > 0) onPointerSelect(); }}
        aria-label={label} data-testid={`toolbar-${type}`} />
      <Icon aria-hidden="true" />
      <span className={styles.caption}>{label}</span>
    </label>)}
    <button type="button" className={`${styles.tool} ${styles.action}`} title="Добавить изображение" aria-label="Добавить изображение"
      disabled={importing} onClick={onImage}>
      <PictureOutlined aria-hidden="true" />
      <span className={styles.caption}>Изображение</span>
    </button>
    {strokeWidth !== undefined && <StrokeWidthControl key={activeTool} width={strokeWidth} color={color} onWidth={onWidth} />}
    <label className={styles.color} title="Цвет рисования">
      <input type="color" aria-label="Цвет рисования" value={color} onChange={event => onColor(event.target.value)} />
    </label>
    <button type="button" className={`${styles.tool} ${styles.action}`} title="Очистить всё" aria-label="Очистить всё"
      disabled={!canClear} onClick={onClear}>
      <DeleteOutlined aria-hidden="true" />
      <span className={styles.caption}>Очистить всё</span>
    </button>
  </div>;
}
