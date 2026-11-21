import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./learning.module.css";

type Box = { left: number; top: number; width: number; height: number };
type Position = { card: Box; spotlight: Box; mask?: string };

const edge = 12;
const gap = 14;
const controls = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [role="tab"], [role="menuitem"], [role="combobox"], [data-learning-interactive="true"]';

function overlap(a: Box, b: Box) {
  return Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
}

function enclose(a: DOMRect, b = a): Box {
  const left = Math.min(a.left, b.left) - 4;
  const top = Math.min(a.top, b.top) - 4;
  return { left, top, width: Math.max(a.right, b.right) + 4 - left, height: Math.max(a.bottom, b.bottom) + 4 - top };
}

function spotlightPath(viewport: Box, regions: Box[]) {
  const path = ({ left, top, width, height }: Box) =>
    `M ${left} ${top} h ${width} v ${height} h ${-width} Z`;
  const holes: Box[] = [];
  for (let region of regions) {
    // Overlapping even-odd holes would dim their intersection.
    for (let index = 0; index < holes.length;) {
      const hole = holes[index];
      if (!overlap(region, hole)) { index++; continue; }
      const left = Math.min(region.left, hole.left);
      const top = Math.min(region.top, hole.top);
      region = { left, top, width: Math.max(region.left + region.width, hole.left + hole.width) - left,
        height: Math.max(region.top + region.height, hole.top + hole.height) - top };
      holes.splice(index, 1);
      index = 0;
    }
    holes.push(region);
  }
  return `path(evenodd, "${[viewport, ...holes].map(path).join(" ")}")`;
}

function menuBounds(menu: HTMLElement) {
  const rect = menu.getBoundingClientRect();
  const { transform, transformOrigin } = getComputedStyle(menu);
  if (transform === "none") return rect;
  // Ant animates the dropdown with scaleY, without changing its layout dimensions.
  const height = menu.offsetHeight;
  const originY = Number.parseFloat(transformOrigin.split(" ")[1]);
  if (!height || !Number.isFinite(originY)) return rect;
  return new DOMRect(rect.x, rect.y - originY * (1 - rect.height / height), rect.width, height);
}

function findPosition(target: DOMRect, width: number, height: number, viewport: Box, protectedBoxes: Box[],
  popup?: DOMRect, secondary?: DOMRect, anchoredPopup?: DOMRect) {
  const midX = target.left + target.width / 2;
  const midY = target.top + target.height / 2;
  const topEdge = Math.min(target.top, anchoredPopup?.top ?? target.top);
  const bottomEdge = Math.max(target.bottom, anchoredPopup?.bottom ?? target.bottom);
  const leftEdge = Math.min(target.left, anchoredPopup?.left ?? target.left);
  const rightEdge = Math.max(target.right, anchoredPopup?.right ?? target.right);
  const columns = [midX - width / 2, target.left, target.right - width];
  const rows = [target.top, midY - height / 2, target.bottom - height];
  const candidates: { left: number; top: number; below?: boolean }[] = [
    ...columns.map((left) => ({ left, top: bottomEdge + gap, below: true })),
    ...(secondary && secondary.bottom > bottomEdge && secondary.bottom - bottomEdge < 100
      ? columns.map((left) => ({ left, top: secondary.bottom + gap, below: true })) : []),
    ...rows.flatMap((top) => [{ left: rightEdge + gap, top }, { left: leftEdge - gap - width, top }]),
    ...columns.map((left) => ({ left, top: topEdge - gap - height })),
  ];
  let best: Box | undefined;
  let bestScore = Infinity;
  for (const coordinate of candidates) {
    const left = Math.round(Math.max(edge, Math.min(coordinate.left, viewport.width - width - edge)));
    const top = Math.round(Math.max(edge, Math.min(coordinate.top, viewport.height - edge)));
    const cardHeight = Math.min(height, viewport.height - top - edge);
    if (cardHeight < Math.min(height, 132)) continue;
    const card = { left, top, width, height: cardHeight };
    const touchesTarget = overlap(card, target) + (popup ? overlap(card, popup) : 0);
    const collision = protectedBoxes.reduce((sum, box) => {
      const area = overlap(card, box);
      return sum + (area > 0 ? 2000 + area : 0);
    }, 0);
    const distance = Math.hypot(Math.max(left - midX, midX - left - width, 0),
      Math.max(top - midY, midY - top - cardHeight, 0));
    const score = (touchesTarget > 0 ? 1_000_000 + touchesTarget : 0) + collision +
      distance + (height - cardHeight) * 4 + (coordinate.below ? 0 : viewport.height);
    if (score < bestScore) {
      best = card;
      bestScore = score;
    }
  }
  return best ?? { left: edge, top: edge, width, height };
}

export function LearningFloatingLayer({ target, container, spotlight, popup, secondaryTarget, layoutVersion, compact, children }: React.PropsWithChildren<{
  target: HTMLElement;
  container?: HTMLElement | null;
  spotlight?: boolean;
  popup?: HTMLElement | null;
  secondaryTarget?: HTMLElement | null;
  layoutVersion: number;
  compact?: boolean;
}>) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position>();
  useLayoutEffect(() => {
    if (!compact) target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [target, compact]);
  useLayoutEffect(() => {
    const panel = wrapper.current;
    if (!panel) return;
    const content = panel.firstElementChild;
    let scheduled = 0;
    let previous = "";
    const update = () => {
      scheduled = 0;
      const anchor = target.getBoundingClientRect();
      const openMenu = popup ? menuBounds(popup) : undefined;
      const anchoredMenu = target.dataset.learningAnchor === "room-mode" ? openMenu : undefined;
      const secondary = secondaryTarget?.getBoundingClientRect();
      const { width } = panel.getBoundingClientRect();
      const { height } = (content ?? panel).getBoundingClientRect();
      const viewport = { left: 0, top: 0, width: document.documentElement.clientWidth, height: window.innerHeight };
      const protectedBoxes = Array.from(document.querySelectorAll<HTMLElement>(controls)).flatMap((element) => {
        if (panel.contains(element) || element.closest('[inert], [aria-hidden="true"]')) return [];
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && overlap(rect, viewport) > 0 &&
          getComputedStyle(element).visibility === "visible" ? [rect] : [];
      });
      if (secondary) protectedBoxes.push(secondary);
      const hole = enclose(anchor, anchoredMenu);
      const regions = [hole];
      if (secondary) regions.push(enclose(secondary));
      if (openMenu && !anchoredMenu) regions.push(enclose(openMenu));
      const next = {
        card: findPosition(anchor, width, height + 2, viewport, protectedBoxes, openMenu, secondary, anchoredMenu),
        spotlight: hole,
        mask: regions.length > 1 ? spotlightPath(viewport, regions) : undefined,
      };
      const signature = JSON.stringify(next);
      if (signature === previous) return;
      previous = signature;
      setPosition(next);
    };
    const schedule = () => {
      if (!scheduled) scheduled = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(content ?? panel);
    observer.observe(target);
    const menuObserver = popup && new MutationObserver(schedule);
    if (popup) {
      observer.observe(popup);
      menuObserver?.observe(popup, { attributes: true, attributeFilter: ["style", "class"] });
      popup.addEventListener("animationend", schedule);
    }
    if (secondaryTarget) observer.observe(secondaryTarget);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      observer.disconnect();
      menuObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      popup?.removeEventListener("animationend", schedule);
      cancelAnimationFrame(scheduled);
    };
  }, [target, container, popup, secondaryTarget, layoutVersion]);

  return createPortal(
    <>
      {spotlight && position && <div aria-hidden="true" data-learning-spotlight
        className={position.mask ? `${styles.spotlight} ${styles.spotlightMask}` : styles.spotlight}
        style={position.mask ? { clipPath: position.mask } : position.spotlight} />}
      <div ref={wrapper} className={compact ? `${styles.floatingCard} ${styles.compact}` : styles.floatingCard}
        style={position ? { left: position.card.left, top: position.card.top, maxHeight: position.card.height } : { visibility: "hidden" }}>
        {children}
      </div>
    </>,
    container ?? document.body,
  );
}
