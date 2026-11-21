import React, { type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./LearningInlineGuide.module.css";

type Props = {
  slot: HTMLElement;
  children: ReactNode;
};

export function LearningInlineGuide({ slot, children }: Props) {
  return createPortal(<div className={styles.guide}>{children}</div>, slot);
}
