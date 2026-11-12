import React from "react";
import { Button, Popover } from "antd";
import { normalizeDrawingColor } from "./drawingColor";
import styles from "./DrawingColorIndicator.module.css";

export type DrawingParticipant = { displayName: string; drawingColor?: string | null };

export function DrawingColorIndicator({ color, participants = [] }: { color: string | null; participants?: readonly DrawingParticipant[] }) {
  if (!color) return null;
  const colors = participants.flatMap(participant => {
    const assigned = normalizeDrawingColor(participant.drawingColor);
    return assigned ? [{ name: participant.displayName, color: assigned }] : [];
  });
  return <Popover trigger="click" placement="bottom" motion={{ motionName: "" }} destroyOnHidden getPopupContainer={trigger => trigger.parentElement ?? document.body} title="Цвета участников" content={<div role="list" aria-label="Цвета участников" className={styles.legend}>
    {colors.map(participant => <div role="listitem" className={styles.participant} key={participant.color}>
      <span className={styles.swatch} style={{ backgroundColor: participant.color }} role="img" aria-label={`${participant.name}: ${participant.color}`} data-testid="drawing-participant-color" data-color={participant.color} />
      <span>{participant.name}{participant.color === color ? " (вы)" : ""}</span>
    </div>)}
    <span className={styles.help}>Цвет новых объектов по умолчанию. Его можно изменить в редакторе.</span>
  </div>}>
    <Button type="text" className={styles.indicator} aria-label={`Ваш цвет по умолчанию: ${color}. Показать цвета участников`} data-testid="room-drawing-color" data-color={color}>
      <span className={styles.swatch} style={{ backgroundColor: color }} aria-hidden="true" />
      <span>Ваш цвет</span>
    </Button>
  </Popover>;
}
