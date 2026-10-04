import React, { useRef } from "react";
import { Button, Flex, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useClipboardNotification } from "../../components/useClipboardNotification";

type CopyHrIdProps = {
  id: string;
  compact?: boolean;
};

export function CopyHrId({ id, compact = false }: CopyHrIdProps) {
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const copyToClipboard = useClipboardNotification();

  const selectValue = () => {
    const selection = window.getSelection();
    if (!selection || !valueRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(valueRef.current);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    const copied = await copyToClipboard(id, {
      success: "ID нанимающего готов к вставке.",
      failure: "ID выделен — скопируйте его вручную.",
    });
    if (!copied) selectValue();
  };

  return (
    <div>
      <Flex gap={8} wrap="wrap" align="center">
        <Typography.Text
          ref={valueRef}
          style={{ overflowWrap: "anywhere", userSelect: "text", fontFamily: "var(--font-code)", fontSize: compact ? 12 : 14 }}
        >
          {id}
        </Typography.Text>
        <Button
          htmlType="button"
          size="small"
          icon={<CopyOutlined />}
          onClick={() => void copy()}
        >
          Скопировать ID нанимающего
        </Button>
      </Flex>
    </div>
  );
}
