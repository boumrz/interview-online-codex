export type DiagramResponseAction = "recover-proof" | "deny-write" | "deny-read" | "reset-document" | "retry" | "conflict" | "accepted";
export function classifyDiagramResponse(status: number, method: "GET" | "POST", sentProof: string | null, currentProof: string | null, connected: boolean): DiagramResponseAction {
  if ((status === 401 || status === 403) && (!connected || sentProof !== currentProof)) return "recover-proof";
  if (status === 403 && method === "POST") return "deny-write";
  if ([401, 403, 404, 410].includes(status)) return "deny-read";
  if (method === "POST" && [400, 413, 422].includes(status)) return "reset-document";
  if (status === 409) return "conflict";
  if (status >= 200 && status < 300) return "accepted";
  return "retry";
}
