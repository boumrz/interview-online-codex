import React, { useEffect, useRef, useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";

type CopyHrIdProps = {
  id: string;
  compact?: boolean;
};

export function CopyHrId({ id, compact = false }: CopyHrIdProps) {
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const selectValue = () => {
    const selection = window.getSelection();
    if (!selection || !valueRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(valueRef.current);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setState("copied");
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setState("idle"), 2000);
    } catch {
      selectValue();
      setState("failed");
    }
  };

  return (
    <div>
      <Group gap="xs" wrap="wrap">
        <Text
          component="span"
          ref={valueRef}
          ff="monospace"
          size={compact ? "xs" : "sm"}
          style={{ overflowWrap: "anywhere", userSelect: "text" }}
        >
          {id}
        </Text>
        <Button
          type="button"
          size={compact ? "compact-xs" : "xs"}
          variant="light"
          color={state === "copied" ? "teal" : "blue"}
          leftSection={state === "copied" ? <IconCheck size={14} /> : <IconCopy size={14} />}
          onClick={() => void copy()}
        >
          {state === "copied" ? "Скопировано" : "Скопировать ID нанимающего"}
        </Button>
      </Group>
      <Text
        size="xs"
        c={state === "failed" ? "red.4" : "dimmed"}
        mt={4}
        aria-live="polite"
        style={{ minHeight: 18 }}
      >
        {state === "copied"
          ? "ID нанимающего скопирован"
          : state === "failed"
            ? "Не удалось скопировать. ID выделен — скопируйте вручную."
            : ""}
      </Text>
    </div>
  );
}
