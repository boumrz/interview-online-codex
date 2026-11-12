import { useLayoutEffect, useRef, useState } from "react";
import { acquireRoomInert } from "../roomInert";

/** Expand the existing canvas in place so its iframe and undo stack survive. */
export function useDiagramExpansion(active: boolean) {
  const panelRef = useRef<HTMLElement>(null);
  const [requested, setRequested] = useState(false);
  const expanded = active && requested;

  useLayoutEffect(() => { if (!active) setRequested(false); }, [active]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!expanded || !panel) return;
    // Inert sibling branches rather than an ancestor: the mounted editor and
    // its recovery dialog stay interactive while the room behind it cannot
    // receive focus. Hidden surfaces retain their own lock across resize.
    const releaseBackground: Array<() => void> = [];
    let branch: HTMLElement = panel;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        releaseBackground.push(acquireRoomInert(sibling));
      }
      if (parent === document.body) break;
      branch = parent;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      for (const release of releaseBackground) release();
      document.body.style.overflow = overflow;
    };
  }, [expanded]);

  return { panelRef, expanded, toggleExpanded: () => setRequested(value => !value) };
}
