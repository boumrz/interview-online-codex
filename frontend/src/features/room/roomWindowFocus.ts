/** Browser event listeners belong to a frame document; navigation replaces that document. */
export function observeDiagramWindow(frame: HTMLIFrameElement | null, attach: (win: Window) => () => void) {
  let detach: (() => void) | undefined;
  const bind = () => {
    detach?.();
    detach = undefined;
    const doc = frame?.contentDocument;
    if (doc?.defaultView && doc.location.pathname.startsWith("/drawio/")) detach = attach(doc.defaultView);
  };
  bind();
  frame?.addEventListener("load", bind);
  return () => { frame?.removeEventListener("load", bind); detach?.(); };
}

/** A top window and the interactive editor iframe count as focus within the same room. */
export function observeRoomWindowFocus(frame: HTMLIFrameElement | null, report: (focused: boolean) => void, host: Window = window) {
  let focused = host.document.hasFocus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: boolean) => {
    if (focused === next) return;
    focused = next;
    report(next);
  };
  function listen(target: Window) {
    const focus = () => {
      clearTimeout(timer);
      if (frame) update(true);
      else report(true);
    };
    const blur = () => {
      if (!frame) { report(false); return; }
      // The receiving frame gains focus after the outer window's blur callback.
      clearTimeout(timer);
      timer = setTimeout(() => update(host.document.hasFocus()), 0);
    };
    target.addEventListener("focus", focus);
    target.addEventListener("blur", blur);
    return () => {
      target.removeEventListener("focus", focus);
      target.removeEventListener("blur", blur);
    };
  }
  const detachHost = listen(host);
  const detachDiagram = observeDiagramWindow(frame, listen);
  return () => { clearTimeout(timer); detachDiagram(); detachHost(); };
}
