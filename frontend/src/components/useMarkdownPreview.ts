import { useCallback, useEffect, useRef, useState } from "react";
import { retainMarkdownPreview } from "./markdownPreviewService";
import type { MarkdownWorkerClient } from "./markdownWorkerClient";

type PreviewResult = {
  readonly markdown: string;
  readonly attempt: number;
  readonly html: string;
  readonly failed: boolean;
};

export function useMarkdownPreview(markdown: string) {
  const clientRef = useRef<MarkdownWorkerClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const empty = !markdown.trim();

  useEffect(() => {
    const retained = retainMarkdownPreview();
    clientRef.current = retained.client;
    return () => {
      clientRef.current = null;
      retained.release();
    };
  }, []);

  useEffect(() => {
    setResult(null);
    const client = clientRef.current;
    if (!client || empty) return;
    const controller = new AbortController();
    void client.render(markdown, controller.signal).then(
      html => {
        if (!controller.signal.aborted) setResult({ markdown, attempt, html, failed: false });
      },
      () => {
        if (!controller.signal.aborted) setResult({ markdown, attempt, html: "", failed: true });
      },
    );
    return () => controller.abort();
  }, [markdown, attempt, empty]);

  const current = result?.markdown === markdown && result.attempt === attempt ? result : null;
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  return {
    html: empty ? "" : current?.html ?? "",
    loading: !empty && current === null,
    error: !empty && current?.failed === true,
    retry,
  };
}
