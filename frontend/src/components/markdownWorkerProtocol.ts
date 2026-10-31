export type MarkdownWorkerRequest = {
  readonly id: number;
  readonly markdown: string;
};

export type MarkdownWorkerResponse =
  | { readonly id: number; readonly html: string }
  | { readonly id: number; readonly error: string };

export interface MarkdownWorkerPort {
  postMessage(request: MarkdownWorkerRequest): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  terminate(): void;
}

function hasRequestId(value: unknown): value is { readonly id: number } {
  return typeof value === "object" && value !== null && "id" in value
    && typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0;
}

export function isMarkdownWorkerRequest(value: unknown): value is MarkdownWorkerRequest {
  return hasRequestId(value) && "markdown" in value && typeof value.markdown === "string";
}

