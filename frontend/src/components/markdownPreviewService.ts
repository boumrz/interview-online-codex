import DOMPurify from "dompurify";
import { createMarkdownWorkerClient } from "./markdownWorkerClient";
import type { MarkdownWorkerClient } from "./markdownWorkerClient";
import type { MarkdownWorkerPort } from "./markdownWorkerProtocol";

function createBrowserWorker(): MarkdownWorkerPort {
  const worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), {
    type: "module",
    name: "markdown-preview",
  });
  // Adapt browser MessageEvent to the small, typed transport contract.
  const port: MarkdownWorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: request => worker.postMessage(request),
    terminate: () => worker.terminate(),
  };
  worker.onmessage = event => port.onmessage?.({ data: event.data });
  worker.onerror = event => port.onerror?.(event);
  worker.onmessageerror = event => port.onmessageerror?.(event);
  return port;
}

let sharedClient: MarkdownWorkerClient | null = null;
let consumers = 0;

/** Lives only while previews are mounted; no completed document cache. */
export function retainMarkdownPreview(): { client: MarkdownWorkerClient; release: () => void } {
  if (!sharedClient) {
    sharedClient = createMarkdownWorkerClient(createBrowserWorker, html => DOMPurify.sanitize(html, {
      ADD_ATTR: ["target", "rel"],
      FORBID_ATTR: ["style"],
      USE_PROFILES: { html: true },
    }));
  }
  const client = sharedClient;
  consumers += 1;
  let released = false;
  return {
    client,
    release() {
      if (released) return;
      released = true;
      consumers -= 1;
      if (consumers === 0) {
        client.dispose();
        sharedClient = null;
      }
    },
  };
}
