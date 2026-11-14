import React, { useId } from "react";
import { BorderOutlined, ClearOutlined, DeleteOutlined, EditOutlined, FontSizeOutlined, LineOutlined, PictureOutlined, SelectOutlined } from "@ant-design/icons";
import { StrokeWidthControl } from "./StrokeWidthControl";
import styles from "./WhiteboardTools.module.css";

function CircleIcon() { return <span aria-hidden="true" className={styles.circleIcon} />; }

const tools = [
  { type: "freedraw", label: "Карандаш", icon: EditOutlined },
  { type: "line", label: "Линия", icon: LineOutlined },
  { type: "rectangle", label: "Прямоугольник", icon: BorderOutlined },
  { type: "ellipse", label: "Круг", icon: CircleIcon },
  { type: "text", label: "Текст", icon: FontSizeOutlined },
  { type: "selection", label: "Выделение", icon: SelectOutlined },
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
    {tools.map(({ type, label, icon: Icon }) => <label key={type} className={styles.tool} title={label}>
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
