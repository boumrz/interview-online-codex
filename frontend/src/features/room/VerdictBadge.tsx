import React from "react";
import { Badge } from "@mantine/core";

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

const VERDICT_COLORS: Record<string, string> = {
  STRONG_HIRE: "green",
  HIRE: "teal",
  NO_HIRE: "orange",
  STRONG_NO_HIRE: "red",
};

export function VerdictBadge({ verdict, size = "sm" }: VerdictBadgeProps) {
  const label = VERDICT_LABELS[verdict] ?? verdict;
  const color = VERDICT_COLORS[verdict] ?? "gray";
  return (
    <Badge color={color} variant="filled" size={size}>
      {label}
    </Badge>
  );
}
