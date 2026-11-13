import React, { useId } from "react";
import { BorderOutlined, ClearOutlined, EditOutlined, FontSizeOutlined, LineOutlined, SelectOutlined } from "@ant-design/icons";
import styles from "./WhiteboardTools.module.css";

const tools = [
  { type: "freedraw", label: "Карандаш", icon: EditOutlined },
  { type: "line", label: "Линия", icon: LineOutlined },
  { type: "rectangle", label: "Прямоугольник", icon: BorderOutlined },
  { type: "text", label: "Текст", icon: FontSizeOutlined },
  { type: "selection", label: "Выделение", icon: SelectOutlined },
  { type: "eraser", label: "Ластик", icon: ClearOutlined },
] as const;

export type WhiteboardTool = typeof tools[number]["type"];

type Props = {
  activeTool: string;
  color: string;
  onSelect(tool: WhiteboardTool): void;
  onPointerSelect(): void;
  onColor(color: string): void;
};

export function WhiteboardTools({ activeTool, color, onSelect, onPointerSelect, onColor }: Props) {
  const group = useId();
  return <div className={styles.bar} role="group" aria-label="Инструменты доски">
    {tools.map(({ type, label, icon: Icon }) => <label key={type} className={styles.tool} title={label}>
      <input type="radio" name={group} checked={activeTool === type} onChange={() => onSelect(type)}
        onClick={event => { if (event.detail > 0) onPointerSelect(); }}
        aria-label={label} data-testid={`toolbar-${type}`} />
      <Icon aria-hidden="true" />
      <span className={styles.caption}>{label}</span>
    </label>)}
    <label className={styles.color} title="Цвет рисования">
      <input type="color" aria-label="Цвет рисования" value={color} onChange={event => onColor(event.target.value)} />
    </label>
  </div>;
}
