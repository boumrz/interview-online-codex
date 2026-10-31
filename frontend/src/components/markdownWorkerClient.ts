import type { MarkdownWorkerPort, MarkdownWorkerResponse } from "./markdownWorkerProtocol";

export interface MarkdownWorkerClient {
  render(markdown: string, signal?: AbortSignal): Promise<string>;
  dispose(): void;
}

type Consumer = {
  readonly resolve: (html: string) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
};

type Job = {
  readonly id: number;
  markdown: string | null;
  readonly consumers: Set<Consumer>;
};

type Outcome = { readonly html: string } | { readonly error: Error };

function abortError(): Error {
  return new DOMException("Markdown rendering cancelled", "AbortError");
}

function isMarkdownWorkerResponse(value: unknown): value is MarkdownWorkerResponse {
  if (typeof value !== "object" || value === null || !("id" in value)
    || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) return false;
  return ("html" in value && typeof value.html === "string" && !("error" in value))
    || ("error" in value && typeof value.error === "string" && !("html" in value));
}

/** Keeps source/HTML only while requested; the worker never receives a render backlog. */
export function createMarkdownWorkerClient(
  createWorker: () => MarkdownWorkerPort,
  sanitize: (html: string) => string,
  timeoutMs = 30_000,
): MarkdownWorkerClient {
  let worker: MarkdownWorkerPort | null = null;
  let inFlight: Job | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let nextId = 0;
  let disposed = false;
  const queue: Job[] = [];

  function clearTimeoutForJob() {
    if (timeout !== null) clearTimeout(timeout);
    timeout = null;
  }

  function settle(job: Job, outcome: Outcome) {
    job.markdown = null;
    for (const consumer of job.consumers) {
      consumer.cleanup();
      if ("error" in outcome) consumer.reject(outcome.error);
      else consumer.resolve(outcome.html);
    }
    job.consumers.clear();
  }

  function failAll(error: Error) {
    clearTimeoutForJob();
    const failedJobs = inFlight ? [inFlight, ...queue] : [...queue];
    inFlight = null;
    queue.length = 0;
    const failedWorker = worker;
    worker = null;
    if (failedWorker) {
      failedWorker.onmessage = null;
      failedWorker.onerror = null;
      failedWorker.onmessageerror = null;
      failedWorker.terminate();
    }
    for (const job of failedJobs) settle(job, { error });
  }

  function receive(activeWorker: MarkdownWorkerPort, data: unknown) {
    if (disposed || activeWorker !== worker || !inFlight) return;
    if (!isMarkdownWorkerResponse(data)) {
      failAll(new Error("Markdown worker rendering failed"));
      return;
    }
    if (data.id !== inFlight.id) return;
    const job = inFlight;
    clearTimeoutForJob();
    if ("error" in data) {
      failAll(new Error("Markdown worker rendering failed"));
      return;
    }
    if (job.consumers.size > 0) {
      try {
        settle(job, { html: sanitize(data.html) });
      } catch {
        failAll(new Error("Markdown worker rendering failed"));
        return;
      }
    } else {
      job.markdown = null;
    }
    inFlight = null;
    pump();
  }

  function getWorker(): MarkdownWorkerPort {
    if (worker) return worker;
    const created = createWorker();
    worker = created;
    created.onmessage = (event) => receive(created, event.data);
    const fail = () => {
      if (created === worker && !disposed) failAll(new Error("Markdown worker rendering failed"));
    };
    created.onerror = fail;
    created.onmessageerror = fail;
    return created;
  }

  function pump() {
    if (disposed || inFlight) return;
    const job = queue.pop();
    if (!job) return;
    if (job.markdown === null || job.consumers.size === 0) {
      pump();
      return;
    }
    inFlight = job;
    try {
      const activeWorker = getWorker();
      timeout = setTimeout(() => {
        failAll(new Error("Markdown worker rendering timed out"));
      }, timeoutMs);
      activeWorker.postMessage({ id: job.id, markdown: job.markdown });
    } catch {
      failAll(new Error("Markdown worker rendering failed"));
    }
  }

  function render(markdown: string, signal?: AbortSignal): Promise<string> {
    if (disposed) return Promise.reject(new Error("Markdown worker client disposed"));
    if (signal?.aborted) return Promise.reject(abortError());
    if (!markdown.trim()) return Promise.resolve("");
    const existing = inFlight?.markdown === markdown ? inFlight
      : queue.find((job) => job.markdown === markdown);
    const job = existing ?? { id: ++nextId, markdown, consumers: new Set<Consumer>() };
    if (!existing) queue.push(job);
    const result = new Promise<string>((resolve, reject) => {
      const consumer: Consumer = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", cancel),
      };
      function cancel() {
        if (!job.consumers.delete(consumer)) return;
        consumer.cleanup();
        reject(abortError());
        if (job.consumers.size > 0) return;
        job.markdown = null;
        const queuedIndex = queue.indexOf(job);
        if (queuedIndex !== -1) queue.splice(queuedIndex, 1);
      }
      job.consumers.add(consumer);
      signal?.addEventListener("abort", cancel, { once: true });
    });
    pump();
    return result;
  }

  return {
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      failAll(new Error("Markdown worker client disposed"));
    },
  };
}
