import React, { useEffect, useId, useRef, useState } from "react";
import { DownOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import { MAX_QUICK_STROKE_WIDTH_PX, MAX_STROKE_WIDTH_PX, MIN_QUICK_STROKE_WIDTH_PX, MIN_STROKE_WIDTH_PX, STROKE_WIDTH_PRESETS } from "./whiteboardStrokeWidth";
import styles from "./WhiteboardTools.module.css";

type Props = {
  readonly width: number;
  readonly color: string;
  readonly onWidth: (width: number) => void;
};

export function StrokeWidthControl({ width, color, onWidth }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(width));
  const trigger = useRef<HTMLButtonElement>(null);
  const skipBlur = useRef(false);
  const popupId = useId();
  const inputId = useId();
  const boundsId = useId();
  const sliderWidth = Math.min(MAX_QUICK_STROKE_WIDTH_PX, Math.max(MIN_QUICK_STROKE_WIDTH_PX, width));

  useEffect(() => { setDraft(String(width)); }, [width]);

  function apply(value: number) {
    if (Number.isInteger(value) && value >= MIN_STROKE_WIDTH_PX && value <= MAX_STROKE_WIDTH_PX) {
      setDraft(String(value));
      if (value !== width) onWidth(value);
    }
  }

  function commitDraft() {
    const value = draft.trim() === "" ? width : Number(draft);
    apply(Number.isFinite(value) ? Math.min(MAX_STROKE_WIDTH_PX, Math.max(MIN_STROKE_WIDTH_PX, Math.round(value))) : width);
  }

  function closeAndFocus() {
    skipBlur.current = true;
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  return <div className={styles.widthControl} onKeyDown={event => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault(); event.stopPropagation();
    setDraft(String(width));
    closeAndFocus();
  }}>
    <Popover
      trigger="click" placement="bottomLeft" open={open} destroyOnHidden motion={{ motionName: "" }}
      onOpenChange={next => { if (next) { skipBlur.current = false; setDraft(String(width)); } setOpen(next); }}
      getPopupContainer={element => element.parentElement ?? element}
      content={<div id={popupId} role="dialog" aria-label="Толщина линии" className={styles.widthPopup}>
        <div className={styles.widthNumberRow}>
          <label htmlFor={inputId}>Толщина, px</label>
          <input id={inputId} type="number" aria-label="Толщина в пикселях" aria-describedby={boundsId} min={MIN_STROKE_WIDTH_PX} max={MAX_STROKE_WIDTH_PX} step={1}
            value={draft} onChange={event => {
              const next = event.currentTarget.value;
              setDraft(next);
              if (next !== "" && Number.isInteger(Number(next)) && Number(next) >= MIN_STROKE_WIDTH_PX && Number(next) <= MAX_STROKE_WIDTH_PX) onWidth(Number(next));
            }}
            onBlur={() => { if (!skipBlur.current) commitDraft(); }}
            onKeyDown={event => {
              if (event.key !== "Enter") return;
              event.preventDefault(); event.stopPropagation();
              commitDraft(); closeAndFocus();
            }} />
        </div>
        <input className={styles.widthSlider} type="range" aria-label="Толщина линии" aria-describedby={boundsId}
          aria-valuetext={width === sliderWidth ? `${sliderWidth} px` : `${sliderWidth} px; своё значение ${width} px`}
          min={MIN_QUICK_STROKE_WIDTH_PX} max={MAX_QUICK_STROKE_WIDTH_PX} step={1} value={sliderWidth} autoFocus
          onChange={event => apply(event.currentTarget.valueAsNumber)}
          onPointerUp={event => apply(event.currentTarget.valueAsNumber)}
          onKeyDown={event => {
            if (event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            apply(event.key === "Home" ? MIN_QUICK_STROKE_WIDTH_PX : MAX_QUICK_STROKE_WIDTH_PX);
          }} />
        <div className={styles.widthLimits} aria-hidden="true"><span>{MIN_QUICK_STROKE_WIDTH_PX} px</span><span>{MAX_QUICK_STROKE_WIDTH_PX} px</span></div>
        <div className={styles.widthPresets} role="group" aria-label="Быстрая толщина">
          {STROKE_WIDTH_PRESETS.map(value => <button key={value} type="button" aria-pressed={width === value}
            onClick={() => apply(value)}>{value} px</button>)}
        </div>
        <p id={boundsId} className={styles.widthHint}>Вручную: {MIN_STROKE_WIDTH_PX}–{MAX_STROKE_WIDTH_PX} px</p>
        <p className={styles.widthHint}>При масштабе 100%</p>
      </div>}
    >
      <button ref={trigger} type="button" className={styles.widthTrigger} title="Выбрать толщину линии"
        aria-label={`Толщина линии: ${width} px`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}>
        <span className={styles.widthSample} aria-hidden="true"><span style={{ height: Math.min(width, MAX_QUICK_STROKE_WIDTH_PX), backgroundColor: color }} /></span>
        <span className={styles.widthValue}>{width} px</span>
        <DownOutlined className={styles.widthArrow} aria-hidden="true" />
      </button>
    </Popover>
  </div>;
}
