import React from "react";
import { Tag } from "antd";
import styles from "./VerdictBadge.module.css";

type VerdictBadgeProps = {
  verdict: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
};

const VERDICT_LABELS: Record<string, string> = {
  STRONG_HIRE: "Strong Hire",
  HIRE: "Hire",
  NO_HIRE: "No Hire",
  STRONG_NO_HIRE: "Strong No Hire",
};

const VERDICT_TONES: Record<string, string> = {
  STRONG_HIRE: "success",
  HIRE: "success",
  NO_HIRE: "warning",
  STRONG_NO_HIRE: "error",
};

export function VerdictBadge({ verdict, size = "sm" }: VerdictBadgeProps) {
  const label = VERDICT_LABELS[verdict] ?? verdict;
  const tone = VERDICT_TONES[verdict] ?? "neutral";
  return (
    <Tag className={`${styles.badge} ${styles[tone]} ${size === "lg" || size === "xl" ? styles.large : ""}`} data-verdict={verdict}>
      {label}
    </Tag>
  );
}
