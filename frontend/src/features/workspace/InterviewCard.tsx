import React, { type ReactNode } from "react";
import { Card, Group, Stack, Text } from "components/antd-compat";
import styles from "./InterviewCard.module.css";

type Props = {
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly badges: ReactNode;
  readonly context: ReactNode;
  readonly children: ReactNode;
  readonly actions: ReactNode;
  readonly ariaLabel: string;
};

export function InterviewCard({ title, subtitle, badges, context, children, actions, ariaLabel }: Props) {
  return (
    <Card className={styles.panel} withBorder role="region" aria-label={ariaLabel}>
      <Stack gap="sm" role="listitem">
        <Group justify="space-between" gap="sm" wrap="wrap">
          <div className={styles.heading}>
            <Text fw={800}>{title}</Text>
            <Text c="gray.5" size="sm">{subtitle}</Text>
          </div>
          <Group gap="xs" wrap="wrap">{badges}</Group>
        </Group>
        {context ? <Group gap="xs" wrap="wrap">{context}</Group> : null}
        {children}
        <Group justify="flex-end" align="center" wrap="wrap">{actions}</Group>
      </Stack>
    </Card>
  );
}

export function taskCountLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} задачи`;
  return `${count} задач`;
}

export function formatInterviewDateTime(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
