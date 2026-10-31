import { renderMarkdownUnsafeHtml } from "./markdown";
import { isMarkdownWorkerRequest } from "./markdownWorkerProtocol";
import type { MarkdownWorkerResponse } from "./markdownWorkerProtocol";

// This module runs only in a dedicated worker; a local declaration avoids mixing
// the frontend DOM library with lib.webworker global declarations.
declare const self: {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(response: MarkdownWorkerResponse): void;
};

self.onmessage = (event) => {
  const request = event.data;
  if (!isMarkdownWorkerRequest(request)) return;
  try {
    self.postMessage({ id: request.id, html: renderMarkdownUnsafeHtml(request.markdown) });
  } catch {
    // Parser errors may include source text; never expose those messages.
    self.postMessage({ id: request.id, error: "Markdown rendering failed" });
  }
};
