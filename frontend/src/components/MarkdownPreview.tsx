import React from "react";
import { Button } from "antd";
import type { useMarkdownPreview } from "./useMarkdownPreview";

type Props = {
  readonly preview: ReturnType<typeof useMarkdownPreview>;
  readonly className?: string;
  readonly emptyText: string;
  readonly emptyContent?: React.ReactNode;
};

export function MarkdownPreviewContent({ preview, className, emptyText, emptyContent }: Props) {
  if (preview.error) return <div role="alert">
    <p>Не удалось подготовить предпросмотр.</p>
    <Button type="link" htmlType="button" onClick={preview.retry}>Повторить предпросмотр</Button>
  </div>;
  if (preview.loading) return null;
  if (!preview.html) return emptyContent ?? (emptyText ? <p>{emptyText}</p> : null);
  return <div className={className} dangerouslySetInnerHTML={{ __html: preview.html }} />;
}
