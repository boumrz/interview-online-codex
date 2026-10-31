import { useCallback, useEffect, useRef, useState } from "react";
import { retainMarkdownPreview } from "./markdownPreviewService";
import type { MarkdownWorkerClient } from "./markdownWorkerClient";

type PreviewResult = {
  readonly documentKey: string;
  readonly markdown: string;
  readonly attempt: number;
  readonly html: string;
  readonly failed: boolean;
};

type SuccessfulPreview = {
  readonly documentKey: string;
  readonly html: string;
};

export function useMarkdownPreview(markdown: string, documentKey = "") {
  const clientRef = useRef<MarkdownWorkerClient | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [lastSuccessful, setLastSuccessful] = useState<SuccessfulPreview | null>(null);
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
    // Keep the painted document while its next version is being prepared.
    // Empty input and a different document retire that retained content.
    setResult(previous => !empty && previous?.documentKey === documentKey ? previous : null);
    setLastSuccessful(previous => !empty && previous?.documentKey === documentKey ? previous : null);
    const client = clientRef.current;
    if (!client || empty) return;
    const controller = new AbortController();
    void client.render(markdown, controller.signal).then(
      html => {
        if (!controller.signal.aborted) {
          setLastSuccessful({ documentKey, html });
          setResult({ documentKey, markdown, attempt, html, failed: false });
        }
      },
      () => {
        if (!controller.signal.aborted) setResult({ documentKey, markdown, attempt, html: "", failed: true });
      },
    );
    return () => controller.abort();
  }, [markdown, attempt, empty, documentKey]);

  const current = result?.documentKey === documentKey && result.markdown === markdown && result.attempt === attempt ? result : null;
  // Gate during render, before effects: retained private HTML must never flash
  // into a newly selected task, room or account.
  const retainedHtml = lastSuccessful?.documentKey === documentKey ? lastSuccessful.html : "";
  const retry = useCallback(() => setAttempt(previous => previous + 1), []);
  return {
    html: empty ? "" : current?.html || retainedHtml,
    loading: !empty && current === null,
    error: !empty && current?.failed === true,
    retry,
  };
}
