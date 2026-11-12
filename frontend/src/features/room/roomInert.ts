const locks = new WeakMap<HTMLElement, { count: number; original: string | null }>();

/** Hidden surfaces and expanded editors can independently disable one branch. */
export function acquireRoomInert(element: HTMLElement): () => void {
  const lock = locks.get(element) ?? { count: 0, original: element.getAttribute("inert") };
  lock.count++;
  locks.set(element, lock);
  element.setAttribute("inert", "");
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count > 0) return;
    if (lock.original === null) element.removeAttribute("inert");
    else element.setAttribute("inert", lock.original);
    locks.delete(element);
  };
}
