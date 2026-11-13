// A server that predates per-task canvases ignores the taskId query parameter.
// Its successful room-wide response must never become a task's editable document.
export function matchesCanvasTask(response: unknown, taskId: string | null): boolean {
  return typeof response === "object" && response !== null && "taskId" in response && response.taskId === taskId;
}

export const canvasTaskMismatch = "Сервер не подтвердил, что рисунок относится к выбранной задаче. Проверьте версию сервера и повторите загрузку.";
