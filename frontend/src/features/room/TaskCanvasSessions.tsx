import React, { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";

type TaskId = string | null;
export type TaskCanvasLifecycle = {
  taskId: TaskId;
  retiring: boolean;
  release(taskId: TaskId): void;
};

/** A switched-away editor stays mounted just long enough to deliver its last edit. */
export function TaskCanvasSessions({ taskId, active, children }: {
  taskId: TaskId;
  active: boolean;
  children(session: TaskCanvasLifecycle): React.ReactNode;
}) {
  const [mounted, setMounted] = useState<TaskId[]>(() => active ? [taskId] : []);
  if (active && !mounted.includes(taskId)) setMounted([...mounted, taskId]);
  const selected = useRef(taskId);
  useLayoutEffect(() => { selected.current = taskId; }, [taskId]);
  const release = useCallback((finished: TaskId) => {
    // An acknowledgement may arrive as the user returns to this very task.
    setMounted(previous => selected.current === finished ? previous : previous.filter(id => id !== finished));
  }, []);

  return <>{mounted.map(id => <Fragment key={id ?? "room"}>
    {children({ taskId: id, retiring: id !== taskId, release })}
  </Fragment>)}</>;
}
