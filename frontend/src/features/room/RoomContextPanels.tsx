import React, {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Tooltip } from "antd";
import { IconHelpCircle } from "components/antd-icons";
import { isRoomReadOnly } from "./roomEditPolicy";

import styles from "./RoomContextPanels.module.css";
import {
  clampSplitValue,
  overviewChatHeightBounds,
  overviewRightColumnBounds,
  reduceSplitValue,
  type SplitBounds,
  type SplitOrientation,
  workAuxiliaryBounds,
} from "./roomContextPanelLayout";

export type RoomContextSurfaceName =
  | "editor"
  | "steps"
  | "condition"
  | "notes"
  | "chat"
  | "activity";

type RoomContextLayoutMode = "focus" | "work" | "overview";

type RoomStatusStep = {
  stepIndex: number;
  title: string;
};

const SURFACES: ReadonlyArray<{
  name: RoomContextSurfaceName;
  tabLabel: string;
  regionTitle: string;
}> = [
  { name: "editor", tabLabel: "Редактор", regionTitle: "Редактор" },
  { name: "steps", tabLabel: "Шаги", regionTitle: "Шаги" },
  { name: "condition", tabLabel: "Условие", regionTitle: "Условие" },
  { name: "notes", tabLabel: "Мои заметки", regionTitle: "Мои заметки" },
  { name: "chat", tabLabel: "Чат", regionTitle: "Чат интервьюеров" },
  {
    name: "activity",
    tabLabel: "Активность",
    regionTitle: "Активность кандидата",
  },
];

const SURFACE_INDEX = new Map(
  SURFACES.map((surface, index) => [surface.name, index]),
);

type AuxiliarySurfaceName = Exclude<RoomContextSurfaceName, "editor" | "condition">;
const AUXILIARY_SURFACES = SURFACES.filter(
  (surface): surface is (typeof surface & { name: AuxiliarySurfaceName }) => surface.name !== "editor" && surface.name !== "condition",
);

type Geometry = {
  width: number;
  height: number;
  surfaceWidth: number;
  surfaceHeight: number;
  conditionSpace: number;
};

const OVERVIEW_MIN_SURFACE_WIDTH = 240 + 480 + 320 + 20;
const OVERVIEW_MIN_SURFACE_HEIGHT = 240 + 320 + 10;

type RoomContextValue = {
  activeSurface: RoomContextSurfaceName;
  activateSurface: (surface: RoomContextSurfaceName) => void;
  mode: RoomContextLayoutMode;
  showAuxiliaryTablist: boolean;
  visibleSurfaces: ReadonlySet<RoomContextSurfaceName>;
};

const RoomContext = createContext<RoomContextValue | null>(null);

function readUsableGeometry(
  element?: HTMLElement | null,
  surfaceGrid?: HTMLElement | null,
): Geometry {
  if (typeof window === "undefined") {
    return {
      width: 1024,
      height: 768,
      surfaceWidth: 1024,
      surfaceHeight: 768,
      conditionSpace: 688,
    };
  }

  const bounds = element?.getBoundingClientRect();
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const surfaceBounds = surfaceGrid?.getBoundingClientRect();
    const surfaceStyle = surfaceGrid ? window.getComputedStyle(surfaceGrid) : null;
    const surfaceWidth = surfaceBounds
      ? surfaceBounds.width - Number.parseFloat(surfaceStyle?.paddingLeft ?? "0") - Number.parseFloat(surfaceStyle?.paddingRight ?? "0")
      : bounds.width;
    const surfaceHeight = surfaceBounds
      ? surfaceBounds.height - Number.parseFloat(surfaceStyle?.paddingTop ?? "0") - Number.parseFloat(surfaceStyle?.paddingBottom ?? "0")
      : bounds.height;
    return {
      width: Math.floor(bounds.width),
      height: Math.floor(bounds.height),
      surfaceWidth: Math.max(0, Math.floor(surfaceWidth)),
      surfaceHeight: Math.max(0, Math.floor(surfaceHeight)),
      conditionSpace: Math.max(0, Math.floor(bounds.height
        - (element?.firstElementChild?.getBoundingClientRect().height ?? 0)
        - Number.parseFloat(window.getComputedStyle(element!).rowGap || "0") * 2
        - Number.parseFloat(surfaceStyle?.paddingBottom ?? "0"))),
    };
  }

  const width = Math.floor(window.visualViewport?.width ?? window.innerWidth);
  const height = Math.floor(window.visualViewport?.height ?? window.innerHeight);
  return {
    width,
    height,
    surfaceWidth: width,
    surfaceHeight: height,
    conditionSpace: Math.max(0, height - 80),
  };
}

function automaticMode(geometry: Geometry): Exclude<RoomContextLayoutMode, "overview"> {
  return geometry.width < 1000 || geometry.height < 440 || workAuxiliaryBounds(geometry.surfaceWidth) == null
    ? "focus" : "work";
}

function isOverviewAvailable(geometry: Geometry): boolean {
  return geometry.width >= 1320
    && geometry.height >= 640
    && geometry.surfaceWidth >= OVERVIEW_MIN_SURFACE_WIDTH
    && geometry.surfaceHeight >= OVERVIEW_MIN_SURFACE_HEIGHT;
}

function surfaceTabId(name: RoomContextSurfaceName): string {
  return `room-context-tab-${name}`;
}

function surfaceRegionId(name: RoomContextSurfaceName): string {
  return `room-context-region-${name}`;
}

function defaultSplitValue(bounds: SplitBounds | null, preferred: number): number {
  return bounds ? clampSplitValue(preferred, bounds) : 0;
}

function RoomLayoutSeparator({
  bounds,
  className,
  label,
  onChange,
  orientation,
  value,
  growthDirection = -1,
}: {
  bounds: SplitBounds;
  className: string;
  label: string;
  onChange: (value: number) => void;
  orientation: SplitOrientation;
  value: number;
  growthDirection?: 1 | -1;
}) {
  const dragRef = useRef<{ pointerId: number; startPosition: number; startValue: number } | null>(null);
  const position = (event: PointerEvent<HTMLButtonElement>) => orientation === "vertical" ? event.clientX : event.clientY;
  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onChange(clampSplitValue(drag.startValue + growthDirection * (position(event) - drag.startPosition), bounds));
  };

  return (
    <button
      type="button"
      className={className}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={value}
      onKeyDown={(event) => {
        const nextValue = reduceSplitValue(value, bounds, event.key, orientation);
        if (nextValue === value && !["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        onChange(nextValue);
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startPosition: position(event),
          startValue: value,
        };
      }}
      onPointerMove={updateFromPointer}
      onPointerUp={(event) => {
        updateFromPointer(event);
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { dragRef.current = null; }}
    />
  );
}

export function RoomStatusStrip({
  role,
  connected,
  localStep,
  publishedStep,
  candidateStatus,
  roomStatus,
}: {
  role: "owner" | "interviewer" | "candidate";
  connected: boolean;
  localStep?: RoomStatusStep;
  publishedStep?: RoomStatusStep;
  candidateStatus?: string;
  roomStatus?: string;
}) {
  const roleLabel = role === "owner"
    ? "Владелец"
    : role === "interviewer"
      ? "Интервьюер"
      : "Кандидат";
  const roleTone = role === "owner" ? "teal" : "blue";
  const showPublishedStep = localStep && publishedStep
    ? localStep.stepIndex !== publishedStep.stepIndex
    : false;

  return (
    <div
      className={styles.statusRow}
      data-testid="room-persistent-status"
      data-has-lifecycle={roomStatus === "finished" || roomStatus === "frozen" ? "true" : undefined}
      role="group"
      aria-label="Статус участника и комнаты"
    >
      <span
        className={styles.statusRoleBadge}
        data-testid="room-viewer-role-badge"
        data-room-role={role}
        data-role-tone={roleTone}
      >
        {roleLabel}
      </span>
      {roomStatus === "finished" || roomStatus === "frozen" ? (
        <span className={styles.lifecycleStatus} role="status" aria-live="polite" data-testid="room-lifecycle-status" data-room-status={roomStatus}>
          <span>{roomStatus === "finished" ? "Интервью завершено" : "Изменения приостановлены"}</span>
          {isRoomReadOnly({ status: roomStatus, canManageRoom: role !== "candidate" }) ? (
            <span className={styles.lifecycleAccess}>Только просмотр</span>
          ) : null}
        </span>
      ) : null}
      {!connected ? (
        <span
          className={styles.statusItem}
          data-testid="room-explicit-connection-status"
          role="status"
          aria-live="polite"
        >
          Соединение: восстанавливается
        </span>
      ) : null}
      {candidateStatus ? (
        <span
          className={styles.statusItem}
          data-testid="room-candidate-presence-status"
          role="status"
          aria-live="polite"
        >
          {`Кандидат: ${candidateStatus}`}
        </span>
      ) : null}
    </div>
  );
}

export function RoomContextPanels({
  children,
  headerAction,
  layoutKey,
  showCondition = true,
}: {
  children: ReactNode;
  headerAction?: ReactNode;
  layoutKey?: string;
  showCondition?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const surfaceGridRef = useRef<HTMLDivElement | null>(null);
  const conditionOwnsFocusRef = useRef(false);
  const tabRefs = useRef(new Map<AuxiliarySurfaceName, HTMLButtonElement>());
  const initialGeometry = useMemo(readUsableGeometry, []);
  const [geometry, setGeometry] = useState(initialGeometry);
  const initialAutomaticMode = automaticMode(initialGeometry);
  const previousAutomaticModeRef = useRef(initialAutomaticMode);
  const [mode, setMode] = useState<RoomContextLayoutMode>(initialAutomaticMode);
  const [activeSurface, setActiveSurface] = useState<RoomContextSurfaceName>(
    "steps",
  );
  const [focusedSurface, setFocusedSurface] =
    useState<RoomContextSurfaceName>(
      "steps",
    );
  const [lastAuxiliarySurface, setLastAuxiliarySurface] =
    useState<AuxiliarySurfaceName>("steps");
  const availableAuxiliarySurfaces = AUXILIARY_SURFACES;
  const [conditionExpanded, setConditionExpanded] = useState(true);
  const [conditionHeight, setConditionHeight] = useState<number | null>(null);
  const childSurfaces = React.Children.toArray(children);
  const conditionChildren = childSurfaces.filter(child => React.isValidElement<{ name?: RoomContextSurfaceName }>(child) && child.props.name === "condition");
  const tabbedChildren = childSurfaces.filter(child => !React.isValidElement<{ name?: RoomContextSurfaceName }>(child) || child.props.name !== "condition");
  const [showBothCommunicationSurfaces, setShowBothCommunicationSurfaces] =
    useState(false);
  const [workAuxiliaryWidth, setWorkAuxiliaryWidth] = useState(() =>
    defaultSplitValue(workAuxiliaryBounds(initialGeometry.surfaceWidth), initialGeometry.surfaceWidth * 0.4),
  );
  const [overviewRightWidth, setOverviewRightWidth] = useState(() =>
    defaultSplitValue(overviewRightColumnBounds(initialGeometry.surfaceWidth), initialGeometry.surfaceWidth * 0.29),
  );
  const [overviewChatHeight, setOverviewChatHeight] = useState(() =>
    defaultSplitValue(overviewChatHeightBounds(initialGeometry.surfaceHeight), initialGeometry.surfaceHeight * 0.58),
  );
  const previousLayoutKeyRef = useRef(layoutKey);

  useLayoutEffect(() => {
    const updateGeometry = () => {
      const next = readUsableGeometry(rootRef.current, surfaceGridRef.current);
      setGeometry((current) =>
        current.width === next.width
          && current.height === next.height
          && current.surfaceWidth === next.surfaceWidth
          && current.surfaceHeight === next.surfaceHeight
          && current.conditionSpace === next.conditionSpace
          ? current
          : next,
      );
    };

    updateGeometry();
    window.addEventListener("resize", updateGeometry);
    window.visualViewport?.addEventListener("resize", updateGeometry);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateGeometry);
    if (rootRef.current) {
      resizeObserver?.observe(rootRef.current);
    }
    if (surfaceGridRef.current) {
      resizeObserver?.observe(surfaceGridRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateGeometry);
      window.visualViewport?.removeEventListener("resize", updateGeometry);
      resizeObserver?.disconnect();
    };
  }, []);

  useEffect(() => {
    const nextAutomaticMode = automaticMode(geometry);
    const previousAutomaticMode = previousAutomaticModeRef.current;
    previousAutomaticModeRef.current = nextAutomaticMode;

    setMode((currentMode) => {
      if (nextAutomaticMode === "focus") {
        return "focus";
      }
      if (currentMode === "overview" && !isOverviewAvailable(geometry)) {
        return "work";
      }
      if (currentMode === "focus" && previousAutomaticMode === "focus") {
        return "work";
      }
      return currentMode;
    });
  }, [geometry]);

  useEffect(() => {
    if (previousLayoutKeyRef.current === layoutKey) return;
    previousLayoutKeyRef.current = layoutKey;
    const nextGeometry = readUsableGeometry(rootRef.current, surfaceGridRef.current);
    const nextMode = automaticMode(nextGeometry);
    previousAutomaticModeRef.current = nextMode;
    setGeometry(nextGeometry);
    setMode(nextMode);
    setActiveSurface("steps");
    setFocusedSurface("steps");
    setLastAuxiliarySurface("steps");
    setConditionExpanded(true);
    setConditionHeight(null);
    setShowBothCommunicationSurfaces(false);
    setWorkAuxiliaryWidth(defaultSplitValue(
      workAuxiliaryBounds(nextGeometry.surfaceWidth),
      nextGeometry.surfaceWidth * 0.4,
    ));
    setOverviewRightWidth(defaultSplitValue(
      overviewRightColumnBounds(nextGeometry.surfaceWidth),
      nextGeometry.surfaceWidth * 0.29,
    ));
    setOverviewChatHeight(defaultSplitValue(
      overviewChatHeightBounds(nextGeometry.surfaceHeight),
      nextGeometry.surfaceHeight * 0.58,
    ));
  }, [layoutKey]);

  const workBounds = workAuxiliaryBounds(geometry.surfaceWidth);
  // The automatic size leaves the editor visible without scrolling. Explicit
  // resizing has a wider range; the editor keeps its minimum height and the
  // room itself scrolls when the participant chooses a larger condition.
  const automaticConditionMaximum = mode === "focus"
    ? Math.max(80, Math.floor(Math.min(geometry.conditionSpace - 180, (window.visualViewport?.height ?? window.innerHeight) * 0.35)))
    : Math.max(80, geometry.conditionSpace - 400);
  const automaticConditionBounds = { min: Math.min(160, automaticConditionMaximum), max: automaticConditionMaximum };
  const conditionBounds = { min: automaticConditionBounds.min, max: Math.max(mode === "focus" ? 240 : automaticConditionBounds.min, geometry.conditionSpace - 180) };
  const resolvedConditionHeight = conditionHeight === null
    ? clampSplitValue(240, automaticConditionBounds)
    : clampSplitValue(conditionHeight, conditionBounds);
  const conditionNeedsRoomScroll = showCondition && conditionExpanded
    && (mode === "work"
      ? resolvedConditionHeight + 400 > geometry.conditionSpace
      : conditionHeight !== null && resolvedConditionHeight > automaticConditionMaximum);
  const overviewRightBounds = overviewRightColumnBounds(geometry.surfaceWidth);
  const overviewChatBounds = overviewChatHeightBounds(geometry.surfaceHeight);
  const resolvedWorkAuxiliaryWidth = workBounds ? clampSplitValue(workAuxiliaryWidth, workBounds) : null;
  const resolvedOverviewRightWidth = overviewRightBounds ? clampSplitValue(overviewRightWidth, overviewRightBounds) : null;
  const resolvedOverviewChatHeight = overviewChatBounds ? clampSplitValue(overviewChatHeight, overviewChatBounds) : null;

  useEffect(() => {
    if (workBounds) setWorkAuxiliaryWidth((current) => clampSplitValue(current, workBounds));
  }, [workBounds?.max, workBounds?.min]);
  useEffect(() => {
    if (overviewRightBounds) setOverviewRightWidth((current) => clampSplitValue(current, overviewRightBounds));
  }, [overviewRightBounds?.max, overviewRightBounds?.min]);
  useEffect(() => {
    if (overviewChatBounds) setOverviewChatHeight((current) => clampSplitValue(current, overviewChatBounds));
  }, [overviewChatBounds?.max, overviewChatBounds?.min]);

  useLayoutEffect(() => {
    // A remote mode change can remove the focused resize handle before this
    // effect runs. Remember focus ownership rather than relying on a removed
    // node still being document.activeElement.
    if (showCondition || !conditionOwnsFocusRef.current) return;
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?? root?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]');
    target?.focus();
    conditionOwnsFocusRef.current = false;
  }, [showCondition]);

  const activateSurface = useCallback((surface: RoomContextSurfaceName) => {
    if (surface === "condition") return;
    setActiveSurface(surface);
    if (surface !== "editor") {
      setLastAuxiliarySurface(surface);
    }
    if (surface !== "chat" && surface !== "activity") {
      setShowBothCommunicationSurfaces(false);
    }
  }, []);

  const moveVisibleFocus = (
    event: KeyboardEvent<HTMLElement>,
    surface: AuxiliarySurfaceName,
  ) => {
    const currentIndex = availableAuxiliarySurfaces.findIndex((item) => item.name === surface);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % availableAuxiliarySurfaces.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + availableAuxiliarySurfaces.length) % availableAuxiliarySurfaces.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = availableAuxiliarySurfaces.length - 1;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateSurface(surface);
      return;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextSurface = availableAuxiliarySurfaces[nextIndex].name;
    setFocusedSurface(nextSurface);
    tabRefs.current.get(nextSurface)?.focus();
  };

  const workAuxiliarySurface =
    activeSurface === "editor" ? lastAuxiliarySurface : activeSurface;
  const selectedAuxiliarySurface: AuxiliarySurfaceName | null = activeSurface === "editor"
    ? mode === "focus" ? null : lastAuxiliarySurface
    : activeSurface as AuxiliarySurfaceName;
  const focusedAuxiliarySurface = focusedSurface === "editor"
    ? lastAuxiliarySurface
    : focusedSurface as AuxiliarySurfaceName;
  const showAuxiliaryTablist = true;
  const visibleSurfaces = useMemo(() => {
    if (mode === "focus") {
      return new Set<RoomContextSurfaceName>([activeSurface, ...(showCondition && conditionExpanded ? ["condition" as const] : [])]);
    }
    if (mode === "work") {
      return new Set<RoomContextSurfaceName>(["editor", workAuxiliarySurface, ...(showCondition && conditionExpanded ? ["condition" as const] : [])]);
    }

    const overviewSurfaces = new Set<RoomContextSurfaceName>(["steps", "editor", ...(showCondition && conditionExpanded ? ["condition" as const] : [])]);
    if (showBothCommunicationSurfaces) {
      overviewSurfaces.add("chat");
      overviewSurfaces.add("activity");
    } else {
      overviewSurfaces.add(
        activeSurface === "editor" || activeSurface === "steps"
          ? lastAuxiliarySurface
          : activeSurface,
      );
    }
    return overviewSurfaces;
  }, [activeSurface, conditionExpanded, mode, showBothCommunicationSurfaces, showCondition, workAuxiliarySurface]);

  const contextValue = useMemo<RoomContextValue>(
    () => ({ activeSurface, activateSurface, mode, showAuxiliaryTablist, visibleSurfaces }),
    [activeSurface, activateSurface, mode, showAuxiliaryTablist, visibleSurfaces],
  );

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-room-context-mode={mode}
      data-room-context-narrow-tabs={geometry.width < 950 ? "true" : "false"}
      data-room-context-condition-scroll={conditionNeedsRoomScroll ? "true" : undefined}
      style={{
        "--room-work-auxiliary-width": resolvedWorkAuxiliaryWidth ? `${resolvedWorkAuxiliaryWidth}px` : undefined,
        "--room-overview-right-width": resolvedOverviewRightWidth ? `${resolvedOverviewRightWidth}px` : undefined,
        "--room-overview-chat-height": resolvedOverviewChatHeight ? `${resolvedOverviewChatHeight}px` : undefined,
      } as React.CSSProperties}
    >
      <div className={styles.controls}>
        {showAuxiliaryTablist ? (
          <div
            className={styles.tabList}
            role="tablist"
            aria-label="Рабочие области комнаты"
            aria-orientation="horizontal"
          >
            {availableAuxiliarySurfaces.map((surface) => (
              <button
                key={surface.name}
                ref={(node) => {
                  if (node) tabRefs.current.set(surface.name, node as HTMLButtonElement);
                  else tabRefs.current.delete(surface.name);
                }}
                id={surfaceTabId(surface.name)}
                type="button"
                role="tab"
                aria-selected={selectedAuxiliarySurface === surface.name}
                aria-controls={surfaceRegionId(surface.name)}
                tabIndex={focusedAuxiliarySurface === surface.name ? 0 : -1}
                className={`${styles.surfaceTab} ${
                  selectedAuxiliarySurface === surface.name ? styles.surfaceTabActive : ""
                }`}
                onFocus={() => setFocusedSurface(surface.name)}
                onKeyDown={(event) => moveVisibleFocus(event, surface.name)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setFocusedSurface(surface.name);
                  activateSurface(surface.name);
                }}
              >
                {surface.tabLabel}
              </button>
            ))}
          </div>
        ) : <div className={styles.tabListSpacer} aria-hidden="true" />}

        <div className={styles.secondaryControls}>
          {headerAction}
          {mode === "focus" && activeSurface !== "editor" ? (
            <Button
              type="text"
              htmlType="button"
              className={styles.modeButton}
              aria-label="Вернуться к редактору"
              onClick={() => setActiveSurface("editor")}
            >
              К редактору
            </Button>
          ) : null}
        </div>
      </div>

      <RoomContext.Provider value={contextValue}>
        {conditionChildren.length > 0 ? <div className={styles.conditionSection} hidden={!showCondition} data-condition-expanded={conditionExpanded ? "true" : "false"} style={{ height: conditionExpanded ? resolvedConditionHeight : 36 }}
          onFocusCapture={() => { conditionOwnsFocusRef.current = true; }}
          onBlurCapture={event => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) conditionOwnsFocusRef.current = false;
          }}
        >
          <button id="room-condition-toggle" type="button" className={styles.conditionToggle} aria-label={conditionExpanded ? "Свернуть условие" : "Развернуть условие"} aria-expanded={conditionExpanded} aria-controls={surfaceRegionId("condition")} onClick={() => setConditionExpanded(value => !value)}>
            <span>Условие</span><span>{conditionExpanded ? "Свернуть условие" : "Развернуть условие"}</span>
          </button>
          {conditionChildren}
          {showCondition && conditionExpanded ? <RoomLayoutSeparator
            bounds={conditionBounds}
            className={styles.conditionHeightSeparator}
            label="Изменить высоту условия"
            onChange={setConditionHeight}
            orientation="horizontal"
            value={resolvedConditionHeight}
            growthDirection={1}
          /> : null}
        </div> : null}
        <div ref={surfaceGridRef} className={styles.surfaceGrid} data-testid="room-context-surface-grid">
          {tabbedChildren}
          {mode === "work" && workBounds && resolvedWorkAuxiliaryWidth ? (
            <RoomLayoutSeparator
              bounds={workBounds}
              className={styles.workWidthSeparator}
              label="Изменить ширину контекстной панели"
              onChange={setWorkAuxiliaryWidth}
              orientation="vertical"
              value={resolvedWorkAuxiliaryWidth}
            />
          ) : null}
          {mode === "overview" && overviewRightBounds && resolvedOverviewRightWidth ? (
            <RoomLayoutSeparator
              bounds={overviewRightBounds}
              className={styles.overviewWidthSeparator}
              label="Изменить ширину правой контекстной колонки"
              onChange={setOverviewRightWidth}
              orientation="vertical"
              value={resolvedOverviewRightWidth}
            />
          ) : null}
          {mode === "overview" && showBothCommunicationSurfaces && overviewChatBounds && resolvedOverviewChatHeight ? (
            <RoomLayoutSeparator
              bounds={overviewChatBounds}
              className={styles.overviewHeightSeparator}
              label="Изменить высоту чата"
              onChange={setOverviewChatHeight}
              orientation="horizontal"
              value={resolvedOverviewChatHeight}
            />
          ) : null}
        </div>
      </RoomContext.Provider>
    </div>
  );
}

export function RoomContextSurface({
  name,
  children,
  className,
}: {
  name: RoomContextSurfaceName;
  children: ReactNode;
  className?: string;
}) {
  const context = useContext(RoomContext);
  const regionRef = useRef<HTMLElement | null>(null);
  const originalTabIndexRef = useRef(
    new Map<HTMLElement, string | null>(),
  );
  if (!context) {
    throw new Error("RoomContextSurface must be rendered inside RoomContextPanels");
  }

  const definition = SURFACES[SURFACE_INDEX.get(name) ?? 0];
  const visible = context.visibleSurfaces.has(name);
  const usesTabLabel = name !== "editor" && name !== "condition" && context.showAuxiliaryTablist;
  const isSupportingEditor =
    visible && name === "editor" && context.activeSurface !== "editor";
  useLayoutEffect(() => {
    const region = regionRef.current;
    if (!region) {
      return;
    }
    const updateTabOrder = () => {
      const retainsActiveFocus = region.contains(document.activeElement);
      if (!visible && retainsActiveFocus) {
        if (name === "condition") {
          const toggle = document.getElementById("room-condition-toggle");
          if (toggle?.getClientRects().length) toggle.focus();
          else {
            const panels = region.closest("[data-room-context-mode]");
            const target = panels?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
              ?? panels?.querySelector<HTMLElement>('[role="tab"][tabindex="0"]');
            target?.focus();
          }
        }
        else if (context.activeSurface !== "editor") {
          document.getElementById(surfaceTabId(context.activeSurface))?.focus();
        }
      }
      const removeFromTabOrder = isSupportingEditor || !visible;
      const focusableElements = region.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [contenteditable="true"], [tabindex]',
      );
      for (const element of focusableElements) {
        if (removeFromTabOrder) {
          if (!originalTabIndexRef.current.has(element)) {
            originalTabIndexRef.current.set(
              element,
              element.getAttribute("tabindex"),
            );
          }
          element.setAttribute("tabindex", "-1");
        } else if (originalTabIndexRef.current.has(element)) {
          const originalTabIndex = originalTabIndexRef.current.get(element);
          if (originalTabIndex === null) {
            element.removeAttribute("tabindex");
          } else if (originalTabIndex !== undefined) {
            element.setAttribute("tabindex", originalTabIndex);
          }
          originalTabIndexRef.current.delete(element);
        }
      }
    };
    updateTabOrder();

    if (!visible || isSupportingEditor) {
      const observer = new MutationObserver(updateTabOrder);
      observer.observe(region, { childList: true, subtree: true });
      return () => observer.disconnect();
    }

    return undefined;
  }, [isSupportingEditor, visible]);
  const classes = [
    styles.surface,
    styles[`surface_${name}`],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={regionRef}
      id={surfaceRegionId(name)}
      role="region"
      aria-label={name === "editor" || !usesTabLabel ? definition.regionTitle : undefined}
      aria-labelledby={usesTabLabel ? surfaceTabId(name) : undefined}
      className={classes}
      aria-hidden={visible ? undefined : true}
      data-room-context-surface={name}
      data-room-context-visible={visible ? "true" : "false"}
      onFocusCapture={(event) => {
        if (name !== "condition" && visible && context.activeSurface !== name) {
          context.activateSurface(name);
        }
        const target = event.target;
        const panels = regionRef.current?.closest<HTMLElement>("[data-room-context-mode]");
        if (visible && panels && target instanceof HTMLElement && target.matches("input, textarea, select, button:focus-visible, a[href]:focus-visible")) {
          for (let parent = target.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
              const bounds = parent.getBoundingClientRect();
              const control = target.getBoundingClientRect();
              const controls = parent === panels ? panels.firstElementChild : null;
              const top = controls && getComputedStyle(controls).position === "sticky"
                ? controls.getBoundingClientRect().bottom : bounds.top + parent.clientTop;
              const bottom = bounds.top + parent.clientTop + parent.clientHeight;
              if (control.top < top) parent.scrollTop -= top - control.top;
              else if (control.bottom > bottom) parent.scrollTop += control.bottom - bottom;
            }
            if (parent === panels) break;
          }
        }
      }}
    >
      <h2 aria-label={definition.regionTitle} className={`${styles.surfaceTitle} ${name === "notes" ? styles.notesTitle : ""}`}>
        {definition.regionTitle}
        {name === "notes" ? <Tooltip trigger={["hover", "focus"]} title="Заметки видны только вам. Другие участники интервью их не увидят.">
          <button type="button" className={styles.notesHelp} aria-label="Кто видит мои заметки"><IconHelpCircle size={16} aria-hidden="true" /></button>
        </Tooltip> : null}
      </h2>
      <div className={styles.surfaceBody}>{children}</div>
    </section>
  );
}
