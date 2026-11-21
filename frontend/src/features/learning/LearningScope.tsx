import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Space,
  Spin,
  Tooltip,
  Tour,
} from "antd";
import { CloseOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { store } from "../../app/store";
import { useAppSelector } from "../../app/hooks";
import { getApiErrorMessage } from "../../services/apiErrors";
import { trackLearningEvent } from "../../services/analytics";
import {
  contextualLearningDefinition,
  emptyTrackProgrammeDescription,
  librarySetCreateCopy,
  type LearningModule,
  type LearningProgressModule,
  type LearningSource,
  type LearningState,
} from "./learningContent";
import {
  useLearningCommandMutation,
  useLearningStateQuery,
  type LearningCommand,
  type LearningContext,
} from "./learningApi";
import {
  getLearningSurface,
  interviewFormGuide,
  onboardingAllowsSurface,
  onboardingArrived,
  onboardingDefinition,
  onboardingForm,
  type LearningForm,
  type LearningSurface,
} from "./onboardingSteps";
import { LearningInlineGuide } from "./LearningInlineGuide";
import { LearningFloatingLayer } from "./LearningFloatingLayer";
import { ROOM_LEARNING_STEPS, useRoomLearningStep } from "./roomLearningSteps";
import { contextLearningDestination, contextLearningSurface, onboardingRecoveryPath, roomRecoveryStep, type ContextSurface } from "./learningNavigation";
import { useContextLearningNavigation, type ContextCheckpoint } from "./useContextLearningNavigation";
import styles from "./learning.module.css";

type HelpContext = {
  open: (opener: HTMLElement) => void;
  busy: boolean;
};
const Help = createContext<HelpContext | null>(null);

type LearningStep = {
  title: string;
  description: string;
  anchors: readonly string[];
  spotlightAnchors?: readonly string[];
  advanceOn?: readonly string[];
  completeWhenVisible?: readonly string[];
  completeWhenPickerOpens?: boolean;
  inlineDescription?: string;
  alternative?: string;
};

type PendingCommand = {
  command: LearningCommand;
  onAccepted?: (state: LearningState) => void;
};

type ScopeProps = React.PropsWithChildren<{
  module?: LearningModule;
  eligible: boolean;
  teamId?: string;
  inviteCode?: string;
  sessionId?: string;
  eventToken?: string | null;
}>;

type LearningScreen = {
  locationKey: string;
  surface?: LearningSurface;
  contextSurface: ContextSurface;
  module: LearningModule;
  teamId?: string;
  inviteCode?: string;
  sessionId?: string;
  eventToken?: string | null;
};
type OnboardingAccess = {
  register: (screen: LearningScreen) => () => void;
  active: boolean;
  setManualActive: (active: boolean) => void;
  repeat: () => void;
  resume: () => void;
  canResume: boolean;
  manualNavigation: ReturnType<typeof useContextLearningNavigation>;
  clearCue: () => void;
  revealHelp: () => void;
};
const Onboarding = createContext<OnboardingAccess | null>(null);

export function OnboardingProvider({ children }: React.PropsWithChildren) {
  const auth = useAppSelector((state) => state.auth);
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationType();
  const arrival = useRef({ pathname: location.pathname, fromHistory: navigation === "POP" });
  // A tab or a filter can replace the query string after a browser Back.
  // It does not change how the user reached this page.
  const arrivedFromHistory = arrival.current.pathname === location.pathname
    ? arrival.current.fromHistory : navigation === "POP";
  useLayoutEffect(() => {
    arrival.current = { pathname: location.pathname, fromHistory: arrivedFromHistory };
  }, [location.pathname, arrivedFromHistory]);
  const [reported, setReported] = useState<LearningScreen>();
  const [active, setActive] = useState(false);
  const [manualActive, setManualActive] = useState(false);
  const [request, setRequest] = useState({ id: 0, resume: false });
  const [resumeStep, setResumeStep] = useState<number>();
  const [cue, setCue] = useState<string>();
  const screen = reported?.locationKey === location.key ? reported : undefined;
  const token = auth.token;
  const accountId = auth.user?.id;
  const manualNavigation = useContextLearningNavigation(screen, accountId, token);
  const register = useCallback((value: LearningScreen) => {
    setReported(value);
    return () => setReported((current) => current === value ? undefined : current);
  }, []);
  const clearCue = useCallback(() => setCue(undefined), []);
  const revealHelp = useCallback(() => setCue(location.key), [location.key]);
  const repeat = useCallback(() => {
    clearCue();
    setRequest((value) => ({ id: value.id + 1, resume: false }));
    if (location.pathname !== "/workspace/personal/interviews") {
      void navigate("/workspace/personal/interviews");
    }
  }, [clearCue, location.pathname, navigate]);
  const resume = useCallback(() => {
    if (resumeStep === undefined) return;
    clearCue();
    setRequest((value) => ({ id: value.id + 1, resume: true }));
    const canResumeHere = screen && onboardingAllowsSurface(resumeStep, screen.surface) &&
      !(arrivedFromHistory && onboardingArrived(resumeStep, screen.surface));
    if (!canResumeHere) {
      const destination = onboardingRecoveryPath(resumeStep);
      if (location.pathname !== destination) void navigate(destination);
    }
  }, [arrivedFromHistory, clearCue, location.pathname, navigate, resumeStep, screen]);
  useEffect(() => {
    setCue(undefined);
    setRequest({ id: 0, resume: false });
  }, [token]);
  const identity = useRef({ token, accountId, registered: Boolean(screen) });
  identity.current = { token, accountId, registered: Boolean(screen) };
  return (
    <Onboarding.Provider value={{ register, active, setManualActive, repeat, resume,
      canResume: resumeStep !== undefined, manualNavigation, clearCue, revealHelp }}>
      {children}
      {token && accountId && (
        <LearningSession
          key={`onboarding:${accountId}:${token}`}
          module="onboarding"
          sessionToken={token}
          context={{
            module: "onboarding", accountId, teamId: screen?.teamId,
            inviteCode: screen?.inviteCode, sessionId: screen?.sessionId, eventToken: screen?.eventToken,
          }}
          isContextCurrent={() => identity.current.token === token &&
            identity.current.accountId === accountId && identity.current.registered}
          suppressOffer={location.state?.suppressLearningOffer === true}
          onActiveChange={setActive}
          onFinished={revealHelp}
          onResumeStepChange={setResumeStep}
          onStartContext={manualNavigation.startFromOffer}
          journey={{
            screen,
            blocked: manualActive || manualNavigation.arriving || Boolean(manualNavigation.activation),
            request,
            historyNavigation: arrivedFromHistory,
          }}
        />
      )}
      {cue === location.key && screen && !active && !manualActive && <LearningHelpCue dismiss={clearCue} />}
    </Onboarding.Provider>
  );
}

export function LearningScope(props: ScopeProps) {
  const auth = useAppSelector((state) => state.auth);
  const location = useLocation();
  const onboarding = useContext(Onboarding);
  const register = onboarding?.register;
  const surface = getLearningSurface(location.pathname);
  const contextSurface = contextLearningSurface(location.pathname);
  const [help, setHelp] = useState<HelpContext | null>(null);
  const pageEligible = Boolean(props.eligible && auth.token && auth.user);
  const formGuide = surface === "personal-create" || surface === "team-create";
  const module = props.module ?? (surface === "personal-create" ? "personal_interviews"
    : surface === "team-create" ? "team_interviews" : undefined);
  const eligible = Boolean(pageEligible && module);
  useLayoutEffect(() => {
    if (!eligible || !contextSurface || !module || !register) return;
    return register({
      locationKey: location.key, surface, contextSurface, module, teamId: props.teamId,
      inviteCode: props.inviteCode, sessionId: props.sessionId, eventToken: props.eventToken,
    });
  }, [eligible, surface, contextSurface, module, register, location.key, props.teamId, props.inviteCode, props.sessionId, props.eventToken]);

  const identity = `${auth.user?.id}:${auth.token}:${module}:${props.teamId ?? ""}:${props.inviteCode ?? ""}:${props.sessionId ?? ""}:${props.eventToken ?? ""}`;
  const authority = useRef({ identity, eligible });
  authority.current = { identity, eligible };
  return (
    <Help.Provider value={eligible && help ? { ...help, busy: help.busy || Boolean(onboarding?.active) } : null}>
      {props.children}
      {eligible && module && auth.user ? (
        <LearningSession
          key={`${identity}:${formGuide ? "form" : "page"}`}
          module={module}
          isContextCurrent={() => authority.current.eligible && authority.current.identity === identity}
          sessionToken={auth.token!}
          context={{
            module, accountId: auth.user.id, teamId: props.teamId,
            inviteCode: props.inviteCode, sessionId: props.sessionId, eventToken: props.eventToken,
          }}
          onHelpChange={setHelp}
          onActiveChange={onboarding?.setManualActive}
          onFinished={onboarding?.revealHelp}
          onRepeat={onboarding?.canResume ? onboarding.resume : onboarding?.repeat}
          repeatLabel={onboarding?.canResume ? "Продолжить первый маршрут" : "Пройти весь маршрут"}
          formGuide={formGuide}
          manualNavigation={onboarding?.manualNavigation}
          contextSurface={contextSurface}
        />
      ) : null}
    </Help.Provider>
  );
}

function LearningSession({
  context,
  module,
  suppressOffer,
  onHelpChange,
  onActiveChange,
  onRepeat,
  repeatLabel,
  onFinished,
  onResumeStepChange,
  onStartContext,
  sessionToken,
  isContextCurrent,
  journey,
  formGuide,
  manualNavigation,
  contextSurface,
}: {
  context: LearningContext;
  module: LearningProgressModule;
  suppressOffer?: boolean;
  onHelpChange?: (value: HelpContext | null) => void;
  onActiveChange?: (active: boolean) => void;
  onRepeat?: () => void;
  repeatLabel?: string;
  onFinished?: () => void;
  onResumeStepChange?: (step?: number) => void;
  onStartContext?: () => void;
  sessionToken: string;
  isContextCurrent: () => boolean;
  journey?: {
    screen?: LearningScreen;
    blocked: boolean;
    request: { id: number; resume: boolean };
    historyNavigation: boolean;
  };
  formGuide?: boolean;
  manualNavigation?: ReturnType<typeof useContextLearningNavigation>;
  contextSurface?: ContextSurface;
}) {
  const navigate = useNavigate();
  const surface = journey?.screen?.surface;
  const reviewingTeamExport = Boolean(journey && surface === "team-candidates" && context.teamId);
  const definition = useMemo(() => module === "onboarding" ? onboardingDefinition(surface)
    : formGuide ? interviewFormGuide(module === "team_interviews") : contextualLearningDefinition(module, contextSurface),
    [module, formGuide, surface, contextSurface]);
  // A final context chapter can follow the last persisted checkpoint.
  const checkpointCount = "checkpointCount" in definition ? definition.checkpointCount : definition.steps.length;
  const query = useLearningStateQuery(context, {
    skip: Boolean(journey && !journey.screen),
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
  });
  const [send] = useLearningCommandMutation();
  const [state, setState] = useState<LearningState>();
  const stateRef = useRef<LearningState>();
  const [opened, setOpened] = useState(false);
  const openedRef = useRef(false);
  const [viewStep, setViewStep] = useState<number | null>(null);
  const [source, setSource] = useState<LearningSource>("help");
  const [automatic, setAutomatic] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const pending = useRef<PendingCommand>();
  const alive = useRef(true);
  const busyRef = useRef(false);
  const opener = useRef<HTMLElement>();
  const panelRef = useRef<HTMLElement | null>(null);
  const previewOpened = useRef(false);
  const skipConflict = useRef(false);
  const repeatHandled = useRef(0);
  const sawTaskForm = useRef(false);
  const requestedFormStep = useRef<number>();
  const openedActivation = useRef<string>();
  const identityCurrent = () => {
    const current = store.getState().auth;
    return (
      isContextCurrent() &&
      current.token === sessionToken &&
      current.user?.id === context.accountId &&
      localStorage.getItem("auth_token") === sessionToken
    );
  };
  useEffect(() => {
    const validateIdentity = () => {
      if (!identityCurrent()) {
        setDenied(true);
        openedRef.current = false;
        setOpened(false);
      }
    };
    window.addEventListener("storage", validateIdentity);
    return () => window.removeEventListener("storage", validateIdentity);
  }, [sessionToken, context.accountId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const acceptState = (next: LearningState) => {
    if (
      !alive.current ||
      !identityCurrent() ||
      (stateRef.current && stateRef.current.revision > next.revision)
    )
      return false;
    stateRef.current = next;
    setState(next);
    return true;
  };
  useEffect(() => {
    if (query.currentData && acceptState(query.currentData) && !query.isError) setDenied(false);
  }, [query.currentData, query.isError]);
  useEffect(() => {
    if (
      query.error &&
      "status" in query.error &&
      [401, 403, 404].includes(Number(query.error.status))
    ) {
      setDenied(true);
      openedRef.current = false;
      setOpened(false);
    }
  }, [query.error]);

  const execute = async (request: PendingCommand) => {
    if (busyRef.current || !identityCurrent()) return;
    const { command, onAccepted } = request;
    let acceptedState: LearningState | undefined;
    busyRef.current = true;
    setBusy(true);
    setError("");
    pending.current = request;
    skipConflict.current = false;
    const submit = () => send({ context, command }).unwrap();
    try {
      const result = await submit().catch(async (cause: unknown) => {
        if (!context.inviteCode || !isStorageUnavailable(cause)) throw cause;
        // Ordinary room updates can briefly hold the lock used to recheck access.
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        if (!alive.current || !identityCurrent()) throw cause;
        return submit();
      });
      if (!alive.current || !identityCurrent()) return;
      const accepted = acceptState(result.state);
      result.events.forEach((event) =>
        trackLearningEvent(module, event, {
          source: command.source,
          attemptType: result.state.attemptType,
          skipped: result.state.skipped,
          version: result.state.version,
        }),
      );
      pending.current = undefined;
      if (accepted) acceptedState = result.state;
    } catch (caught) {
      if (!alive.current || !identityCurrent()) return;
      const status =
        caught && typeof caught === "object" && "status" in caught
          ? Number(caught.status)
          : 0;
      if ([401, 403, 404].includes(status)) {
        setDenied(true);
        openedRef.current = false;
        setOpened(false);
      } else if (status === 409) {
        pending.current = undefined;
        skipConflict.current = command.action === "offer_skip";
        void query.refetch();
        if (command.action === "offer_seen") {
          if (openedRef.current) {
            previewOpened.current = false;
            close(false);
          }
          return;
        }
        if (!skipConflict.current) setViewStep(null);
      }
      setError(
        getApiErrorMessage(
          caught,
          "Не удалось сохранить прогресс. Повторите попытку.",
        ),
      );
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
    if (acceptedState && openedRef.current) onAccepted?.(acceptedState);
  };
  const command = (
    action: LearningCommand["action"],
    options: {
      step?: number;
      from?: LearningSource;
      onAccepted?: PendingCommand["onAccepted"];
    } = {},
  ) => {
    if (!stateRef.current) return Promise.resolve();
    return execute({
      command: {
        commandId: crypto.randomUUID(),
        expectedVersion: stateRef.current.version,
        expectedRevision: stateRef.current.revision,
        action,
        source: options.from ?? source,
        step: options.step,
      },
      onAccepted: options.onAccepted,
    });
  };

  const historyArrival = (step: number) => Boolean(journey?.historyNavigation && onboardingArrived(step, surface));
  const resumeStep = journey && !denied && state?.status === "in_progress" ? state.completedSteps : undefined;
  const canResumeJourney = Boolean(resumeStep !== undefined &&
    onboardingAllowsSurface(resumeStep, surface) && !historyArrival(resumeStep));
  const startsInSection = Boolean(journey?.screen && source === "offer" && surface !== "personal-interviews");
  const recoveringRoom = Boolean(journey?.request.resume && resumeStep !== undefined && resumeStep >= 6 &&
    (surface === "personal-interviews" || surface === "personal-create"));
  useLayoutEffect(() => {
    onResumeStepChange?.(resumeStep);
    return () => onResumeStepChange?.(undefined);
  }, [onResumeStepChange, resumeStep]);

  useEffect(() => {
    if (!journey?.screen || !state || suppressOffer || journey.blocked ||
        query.isFetching || query.isError || denied || opened || previewOpened.current ||
        journey.request.id > repeatHandled.current) return;
    const showWelcome = state.status === "new" && !state.skipped;
    const resume = canResumeJourney;
    if (!showWelcome && !resume) return;
    const workingForm = showWelcome && surface?.endsWith("-create")
      ? "interview" : onboardingForm(state.completedSteps, surface);
    const showPreview = () => {
      if (openedRef.current || previewOpened.current || document.visibilityState !== "visible" ||
          workDialogVisible(workingForm) || !identityCurrent()) return;
      previewOpened.current = true;
      openedRef.current = true;
      setAutomatic(true);
      setSource("offer");
      setWelcome(showWelcome);
      setViewStep(showWelcome ? null : Math.min(state.completedSteps, definition.steps.length - 1));
      setOpened(true);
    };
    showPreview();
    const timer = window.setInterval(showPreview, 300);
    return () => window.clearInterval(timer);
  }, [Boolean(journey?.screen), journey?.blocked, journey?.request, surface, state, suppressOffer,
    query.isFetching, query.isError, denied, opened, definition.steps.length, canResumeJourney]);

  const close = (restoreFocus = true) => {
    openedRef.current = false;
    manualNavigation?.recordClose();
    setOpened(false);
    setAutomatic(false);
    setWelcome(false);
    setViewStep(null);
    if (!restoreFocus) return;
    const restore = opener.current;
    requestAnimationFrame(() => {
      if (!identityCurrent() || openedRef.current) return;
      const fallback = document.querySelector<HTMLButtonElement>('[data-learning-help="true"]');
      (restore?.isConnected && isVisible(restore) ? restore : fallback)?.focus();
    });
  };

  const startOrResume = (from: LearningSource, startContext?: () => void) => {
    void command(stateRef.current?.status === "in_progress" ? "resume" : "start", {
      from,
      onAccepted: (next) => {
        if (next.status === "in_progress") {
          if (startContext) {
            close(false);
            startContext();
            return;
          }
          setWelcome(false);
          setViewStep(Math.min(requestedFormStep.current ?? next.completedSteps, next.completedSteps, definition.steps.length - 1));
          requestedFormStep.current = undefined;
        }
      },
    });
  };
  const open = (element?: HTMLElement, formStep?: number, from: LearningSource = "help") => {
    if (busyRef.current || openedRef.current || !identityCurrent()) return;
    const refresh = Boolean(pending.current);
    pending.current = undefined;
    setError("");
    opener.current = element;
    requestedFormStep.current = formStep;
    manualNavigation?.recordOpen(formStep);
    openedRef.current = true;
    previewOpened.current = true;
    setAutomatic(false);
    setSource(from);
    setOpened(true);
    const begin = () => {
      if (!openedRef.current || !stateRef.current) return;
      if (from === "offer") startOrResume(from);
      else void command("manual_open", { from, onAccepted: () => startOrResume(from) });
    };
    if (refresh) {
      void query.refetch().unwrap().then((next) => {
        if (acceptState(next)) begin();
      }).catch((cause) => {
        if (identityCurrent() && openedRef.current) {
          setError(getApiErrorMessage(cause, "Не удалось загрузить прогресс"));
        }
      });
    } else begin();
  };
  const activation = manualNavigation?.activation;
  useEffect(() => {
    if (!activation || openedActivation.current === activation.locationKey || !state ||
        query.isFetching || query.isError || denied || busyRef.current || !identityCurrent()) return;
    openedActivation.current = activation.locationKey;
    if (!activation.restored || state.status === "in_progress") open(undefined, activation.formStep, activation.source);
    manualNavigation?.consume();
  }, [activation, state, query.isFetching, query.isError, denied, busy]);
  const recordContextOpen = manualNavigation?.recordOpen;
  useEffect(() => {
    if (opened && formGuide && viewStep !== null) recordContextOpen?.(viewStep);
  }, [opened, formGuide, viewStep, recordContextOpen]);
  const completeJourney = (restoreFocus = true) => {
    close(restoreFocus);
    onFinished?.();
  };
  const skip = () => void command("offer_skip", { from: "offer", onAccepted: () => completeJourney() });
  useEffect(() => {
    if (!journey || journey.request.id <= repeatHandled.current ||
        (journey.request.resume ? !(canResumeJourney || recoveringRoom) : surface !== "personal-interviews") ||
        journey.blocked || !state || query.isFetching || query.isError || denied || busyRef.current) return;
    repeatHandled.current = journey.request.id;
    previewOpened.current = true;
    openedRef.current = true;
    setAutomatic(true);
    setSource("help");
    setWelcome(!journey.request.resume);
    setViewStep(null);
    setOpened(true);
    if (journey.request.resume) startOrResume("help");
  }, [journey?.request, journey?.blocked, surface, state, query.isFetching, query.isError, denied, busy,
    canResumeJourney, recoveringRoom]);

  const startJourney = () => {
    const current = stateRef.current;
    if (!current) return;
    const begin = () => startOrResume(source, startsInSection ? onStartContext : undefined);
    if (current.status === "in_progress" && source === "help") {
      void command("cancel", { from: source, onAccepted: begin });
    } else if (!current.offerSeen) {
      void command("offer_seen", { from: source, onAccepted: begin });
    } else begin();
  };

  const retry = () => {
    if (pending.current) {
      void execute(pending.current);
      return;
    }
    void query.refetch().unwrap().then((next) => {
      if (!acceptState(next) || !openedRef.current) return;
      setError("");
      if (skipConflict.current) skip();
      else if (welcome && !next.skipped) return;
      else if (automatic && next.status !== "in_progress") close();
      else startOrResume(source);
    }).catch((cause) => {
      if (identityCurrent() && openedRef.current) {
        setError(getApiErrorMessage(cause, "Не удалось загрузить прогресс"));
      }
    });
  };

  const forward = (restoreFocusOnFinish = true) => {
    const saved = stateRef.current;
    if (viewStep === null || saved?.status !== "in_progress" || busyRef.current || error) return;
    const nextStep = viewStep + 1;
    const advance = () => {
      if (nextStep === definition.steps.length) {
        void command("finish", { onAccepted: () => completeJourney(restoreFocusOnFinish) });
      } else setViewStep(nextStep);
    };
    if (nextStep <= saved.completedSteps || nextStep > checkpointCount) {
      advance();
    } else {
      void command("step", {
        step: nextStep,
        onAccepted: (next) => {
          if (next.attempt === saved.attempt && next.completedSteps >= nextStep) advance();
        },
      });
    }
  };

  const onStepSurface = welcome ? startsInSection || surface === "personal-interviews"
    : viewStep === null || recoveringRoom || (onboardingAllowsSurface(viewStep, surface) && !historyArrival(viewStep));
  const visible = opened && !denied && (!journey || (!journey.blocked && Boolean(journey.screen) && onStepSurface));
  const roomStepIndex = viewStep === null || !visible ? null
    : module === "room" ? viewStep
    : surface === "room" && !recoveringRoom && viewStep >= definition.steps.length - ROOM_LEARNING_STEPS.length
      ? viewStep - (definition.steps.length - ROOM_LEARNING_STEPS.length) : null;
  const roomStep = useRoomLearningStep(roomStepIndex);
  const step: LearningStep | undefined = viewStep === null ? undefined
    : recoveringRoom ? roomRecoveryStep : roomStep ?? definition.steps[viewStep];
  const taskStep = journey ? viewStep === 1 : module === "library" && viewStep === 0;
  const librarySetStep = module === "library" && viewStep === 1;
  const contextTeamStep = !journey && step?.anchors.includes("workspace-create-team");
  const workingForm = formGuide || (journey && surface?.endsWith("-create")) ? "interview"
    : taskStep ? "task" : librarySetStep ? "task-set" : contextTeamStep ? "team"
    : journey ? onboardingForm(viewStep, surface) : undefined;
  const { target, covered, positionVersion, container, dialog, guideSlot, completionMatch, pickerExpanded, pickerPopup, setsOpen,
    spotlightTarget } = useTourTarget(visible, step?.anchors, workingForm, step?.completeWhenVisible, step?.spotlightAnchors, roomStepIndex !== null);
  const renderedStep = librarySetStep && (target?.dataset.learningAnchor === "library-create-set" || guideSlot)
    ? { ...step, ...librarySetCreateCopy }
    : librarySetStep && setsOpen
      ? { ...step, title: "Посмотрите наборы задач", description: "В наборах хранятся подборки задач, которые можно повторно использовать в интервью." }
      : module === "tracks" && viewStep === 1 && target?.dataset.learningAnchor === "track-search"
        ? { ...step, description: emptyTrackProgrammeDescription }
        : step;
  const popupVisible = visible && !covered && (welcome || Boolean(target || guideSlot) || viewStep === null);
  const ownsContext = journey ? popupVisible : visible;
  useLayoutEffect(() => {
    onActiveChange?.(ownsContext);
    return () => onActiveChange?.(false);
  }, [ownsContext, onActiveChange]);

  useEffect(() => {
    if (popupVisible && welcome && source === "offer" && state && !state.offerSeen &&
        !busyRef.current && !error && !query.isFetching && !query.isError) {
      void command("offer_seen");
    }
  }, [popupVisible, welcome, source, state, busy, error, query.isFetching, query.isError]);

  useEffect(() => {
    sawTaskForm.current = false;
  }, [viewStep]);

  useEffect(() => {
    if (!visible || !step || viewStep === null || busyRef.current || state?.status !== "in_progress" ||
        query.isFetching || query.isError || error) return;
    if ((taskStep || librarySetStep) && guideSlot) {
      sawTaskForm.current = true;
      return;
    }
    // Opening a native dialog can be the accepted result of the lesson.
    if ((completionMatch && step.completeWhenVisible?.includes(completionMatch)) ||
        (step.completeWhenPickerOpens && pickerExpanded)) {
      forward(false);
      return;
    }
    if (covered) return;
    if ((journey && onboardingArrived(viewStep, surface)) || ((taskStep || librarySetStep) && sawTaskForm.current) ||
        (module === "library" && taskStep && setsOpen && source === "offer")) {
      forward(false);
    }
  }, [Boolean(journey), visible, viewStep, surface, guideSlot, covered, busy, state?.status, taskStep, librarySetStep, setsOpen, source, module,
    completionMatch, step?.completeWhenVisible, step?.completeWhenPickerOpens, pickerExpanded,
    query.isFetching, query.isError, error]);

  useLayoutEffect(() => {
    if (!visible || covered || !target || guideSlot || welcome) return;
    target.dataset.learningFocus = "true";
    return () => { delete target.dataset.learningFocus; };
  }, [visible, covered, target, guideSlot, welcome]);

  useEffect(() => {
    const actions = step?.advanceOn;
    if (!visible || covered || busyRef.current || error || (!actions?.length && !formGuide)) return;
    const onAction = (event: Event) => {
      const node = event.target;
      if (!event.isTrusted || !(node instanceof Element)) return;
      if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) return;
      const element = node.closest<HTMLElement>("[data-learning-action], [data-learning-anchor]");
      const teamForm = event.type === "submit" && node.matches('[data-learning-onboarding-dialog="team"]');
      const action = teamForm ? "workspace-team-form" : element?.dataset.learningAction ?? element?.dataset.learningAnchor;
      const formSubmit = formGuide && event.type === "submit" && action === "interview-form";
      if (!action || (!formSubmit && !actions?.includes(action)) || (dialog && !dialog.contains(node))) return;
      const textInput = node.matches('input:not([type]), input[type="text"], input[type="search"], textarea');
      if (textInput !== (event.type === "change")) return;
      if (manualNavigation && contextLearningDestination(action, contextSurface)) {
        const saved = stateRef.current;
        const nextStep = viewStep === null ? 0 : viewStep + 1;
        const last = nextStep === definition.steps.length;
        const finishesTeamChapter = last && nextStep > checkpointCount;
        const checkpoint: ContextCheckpoint | undefined = saved?.status === "in_progress" && nextStep === saved.completedSteps + 1
          ? {
            context,
            attempt: saved.attempt,
            last,
            command: {
              commandId: crypto.randomUUID(),
              expectedVersion: saved.version,
              expectedRevision: saved.revision,
              action: finishesTeamChapter ? "finish" : "step",
              source,
              step: finishesTeamChapter ? undefined : nextStep,
            },
          }
          : undefined;
        if (identityCurrent()) manualNavigation.arm(action, checkpoint);
        return;
      }
      queueMicrotask(() => {
        if (openedRef.current && identityCurrent()) forward(false);
      });
    };
    document.addEventListener("click", onAction, true);
    document.addEventListener("change", onAction, true);
    if (manualNavigation) document.addEventListener("submit", onAction, true);
    return () => {
      document.removeEventListener("click", onAction, true);
      document.removeEventListener("change", onAction, true);
      document.removeEventListener("submit", onAction, true);
    };
  }, [visible, covered, viewStep, dialog, step?.advanceOn, busy, error, state?.revision, manualNavigation,
    contextSurface, formGuide, checkpointCount, definition.steps.length, source]);
  const preparePanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel) return;
    const initialFocus = panelRef.current !== panel;
    panelRef.current = panel;
    if (initialFocus && welcome) panel.querySelector("h2")?.focus({ preventScroll: true });
  }, [welcome]);

  useLayoutEffect(() => {
    if (!visible || covered) return;
    const handleKey = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel?.isConnected || workDialogVisible(workingForm) || pickerOpen(target) ||
          (roomStepIndex !== null && expandedRoomModePicker())) return;
      if (event.key === "Escape") {
        const expandedCanvas = roomStepIndex !== null && document.querySelector('[data-learning-canvas-expanded="true"]');
        if ((dialog || expandedCanvas) && !panel.contains(document.activeElement)) return;
        event.preventDefault();
        event.stopPropagation();
        if (automatic) completeJourney();
        else close();
      } else if (event.key === "Tab") {
        if (!welcome || guideSlot) return;
        const controls = focusableControls(panel);
        if (!controls.length) return;
        const index = controls.findIndex((control) => control === document.activeElement);
        const next = index === -1 && event.shiftKey
          ? controls.length - 1
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        event.preventDefault();
        controls[next].focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  });

  const help = denied ? null : { open, busy: busy || opened || (!state && !query.isError) };
  useLayoutEffect(() => {
    onHelpChange?.(help);
    return () => onHelpChange?.(null);
  }, [denied, opened, busy, Boolean(state), query.isError, module, onHelpChange]);

  if (!popupVisible) return null;
  const errorText = error || (query.isError ? "Не удалось загрузить прогресс" : "");
  const card = (
    <div ref={preparePanel} className={styles.tourCard} data-learning-tour="true"
      role={guideSlot ? undefined : "dialog"} aria-label={guideSlot ? undefined : `Подсказки · ${definition.title}`}>
      <div className={styles.tourHeader}>
        <h2 className={styles.tourTitle} tabIndex={-1}
          data-learning-step={viewStep === null ? undefined : viewStep + 1}>
          {welcome ? "Знакомство с InterHub" : renderedStep?.title ?? definition.title}
        </h2>
        <Button type="text" size="small" aria-label="Закрыть обучение"
          icon={<CloseOutlined />} onClick={() => automatic ? completeJourney() : close()} />
      </div>
      {welcome ? (
        <>
          <p className={styles.tourDescription}>
            InterHub — платформа для технических собеседований. Здесь можно подготовить встречу,
            работать с кандидатом в общем редакторе и зафиксировать результат.
          </p>
          <p className={styles.tourDescription}>
            {startsInSection ? "Начнём с раздела, который у вас открыт." : "Обучение покажет, как это сделать."}{" "}
            Вернуться к подсказкам можно через «?».
          </p>
        </>
      ) : renderedStep && <p className={styles.tourDescription}>{guideSlot && "inlineDescription" in renderedStep
        ? renderedStep.inlineDescription ?? renderedStep.description : renderedStep.description}</p>}
      {!welcome && viewStep === null && !errorText && <Spin size="small" aria-label="Загрузка прогресса" />}
      {errorText && <span role="alert" className={styles.tourError}>{errorText}</span>}
      {manualNavigation?.retryCheckpoint && (
        <div role="alert" className={styles.tourError}>
          Не удалось сохранить предыдущий шаг.
          <Button type="link" size="small" onClick={manualNavigation.retryCheckpoint}>Повторить сохранение шага</Button>
        </div>
      )}
      <div className={styles.tourFooter}>
        {viewStep !== null && (
          <span className={styles.stepCount} role="status">Шаг {viewStep + 1} из {definition.steps.length}</span>
        )}
        <Space size="small" wrap className={styles.tourActions}>
          {errorText ? (
            <Button size="small" type="primary" onClick={retry} disabled={busy}>Повторить</Button>
          ) : welcome ? (
            <Button size="small" type="primary" aria-label="Начать обучение"
              onClick={startJourney} disabled={busy} loading={busy}>Начать обучение</Button>
          ) : step ? (
            <>
              {step.alternative && !(guideSlot && (journey || contextTeamStep)) && (
                <Button size="small" onClick={() => forward()} disabled={busy}>{step.alternative}</Button>
              )}
              {reviewingTeamExport && viewStep === 4 && (
                <Button size="small" disabled={busy} onClick={() => void navigate(`/workspace/teams/${context.teamId}/interviews`)}>
                  К списку интервью
                </Button>
              )}
              {onRepeat && (
                <Button size="small" type="link" disabled={busy}
                  onClick={() => { close(false); onRepeat(); }}>{repeatLabel}</Button>
              )}
            </>
          ) : null}
        </Space>
      </div>
      {automatic && (
        <div className={styles.skipRow}>
          <Button size="small" type="text" disabled={busy} onClick={skip}>Пропустить обучение</Button>
        </div>
      )}
    </div>
  );
  if (guideSlot) return <LearningInlineGuide slot={guideSlot}>{card}</LearningInlineGuide>;
  if (target && !welcome) return (
    <LearningFloatingLayer layoutVersion={positionVersion} target={target} container={container}
      popup={pickerPopup} secondaryTarget={spotlightTarget}
      spotlight={module === "room" || surface === "room"}>{card}</LearningFloatingLayer>
  );
  return (
    <Tour
      key={positionVersion}
      open
      steps={[{ title: null, description: card, target: null }]}
      keyboard={false}
      zIndex={1600}
      getPopupContainer={container ? () => container : undefined}
      disabledInteraction={welcome}
      mask={welcome ? { color: "rgba(3, 8, 20, 0.64)" } : false}
      closable={false}
      classNames={{ section: styles.tour }}
      styles={{ description: { padding: 0 }, footer: { display: "none" } }}
    />
  );
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0 &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    getComputedStyle(element).visibility === "visible";
}

function isStorageUnavailable(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("status" in cause) || cause.status !== 503 || !("data" in cause)) return false;
  const { data } = cause;
  return Boolean(data && typeof data === "object" && "code" in data && data.code === "DATABASE_UNAVAILABLE");
}

function findLearningForm(kind?: LearningForm) {
  if (!kind) return null;
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-learning-onboarding-dialog="${kind}"]`))
    .find(isVisible) ?? null;
}

function findLearningDialog(kind?: LearningForm) {
  return findLearningForm(kind)?.closest<HTMLElement>('[role="dialog"]') ?? null;
}

function workDialogVisible(kind?: LearningForm) {
  const learningDialog = findLearningDialog(kind);
  return Array.from(document.querySelectorAll<HTMLElement>(
    '[role="dialog"]:not([data-learning-tour]), [role="alertdialog"]',
  )).some((dialog) => dialog !== learningDialog && isVisible(dialog));
}

const interactiveSelector =
  'input:not([type]), input[type="text"], input[type="search"], [role="tab"], [data-learning-interactive="true"]';
const focusableSelector =
  'button, a[href], input, select, textarea, [role="tab"], [tabindex]:not([tabindex="-1"])';
const openPickerSelector =
  '[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]';

function interactiveRegion(target: HTMLElement | null) {
  const region = target?.closest<HTMLElement>(interactiveSelector);
  return region && !region.matches(':disabled, [aria-disabled="true"]') ? region : null;
}

function focusableControls(region: HTMLElement) {
  const nodes = region.matches(focusableSelector)
    ? [region] : Array.from(region.querySelectorAll<HTMLElement>(focusableSelector));
  return nodes.filter((node) => (node === region || node.tabIndex >= 0) &&
    !node.matches(':disabled, [aria-disabled="true"]') && isVisible(node));
}

function expandedPicker(target: HTMLElement | null) {
  const region = interactiveRegion(target);
  return region?.matches(openPickerSelector) ? region : region?.querySelector<HTMLElement>(openPickerSelector) ?? null;
}

function pickerOpen(target: HTMLElement | null) {
  return Boolean(expandedPicker(target));
}

function expandedRoomModePicker() {
  return document.querySelector<HTMLElement>('[data-learning-anchor="room-mode"] [role="combobox"][aria-expanded="true"]');
}

function useTourTarget(
  open: boolean,
  anchors?: readonly string[],
  workingForm?: LearningForm,
  completionAnchors?: readonly string[],
  spotlightAnchors?: readonly string[],
  watchRoomMode = false,
) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [spotlightTarget, setSpotlightTarget] = useState<HTMLElement | null>(null);
  const [covered, setCovered] = useState(false);
  const [dialog, setDialog] = useState<HTMLElement | null>(null);
  const [guideSlot, setGuideSlot] = useState<HTMLElement | null>(null);
  const [completionMatch, setCompletionMatch] = useState<string>();
  const [pickerExpanded, setPickerExpanded] = useState(false);
  const [pickerPopup, setPickerPopup] = useState<HTMLElement | null>(null);
  const [setsOpen, setSetsOpen] = useState(false);
  const [positionVersion, setPositionVersion] = useState(0);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    let previousTarget: HTMLElement | null = null;
    let previousGeometry = "";
    const update = () => {
      frame = 0;
      const form = findLearningForm(workingForm);
      const work = findLearningDialog(workingForm);
      const next = anchors?.flatMap((name) => Array.from(
        (work ?? form ?? document).querySelectorAll<HTMLElement>(`[data-learning-anchor="${CSS.escape(name)}"]`),
      )).find(isVisible) ?? null;
      const rect = next?.getBoundingClientRect();
      const geometry = rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(":") : "";
      // Ant Tour measures when the target changes. An expanded surface can move
      // the same DOM node without changing its identity.
      if (next && previousTarget === next && previousGeometry !== geometry) {
        setPositionVersion((version) => version + 1);
      }
      previousTarget = next;
      previousGeometry = geometry;
      setTarget(next);
      setSpotlightTarget(spotlightAnchors?.flatMap((name) => Array.from(document.querySelectorAll<HTMLElement>(
        `[data-learning-anchor="${CSS.escape(name)}"]`,
      ))).find(isVisible) ?? null);
      setContainer(work ?? Array.from(document.querySelectorAll<HTMLElement>(
        '[data-learning-canvas-expanded="true"]',
      )).find(isVisible) ?? null);
      setDialog(work);
      setGuideSlot(form?.querySelector<HTMLElement>("[data-learning-form-guide-slot]") ?? null);
      setCompletionMatch(completionAnchors?.find((name) => Array.from(document.querySelectorAll<HTMLElement>(
        `[data-learning-anchor="${CSS.escape(name)}"]`,
      )).some(isVisible)));
      const picker = expandedPicker(next);
      const roomPicker = watchRoomMode ? expandedRoomModePicker() : null;
      const listId = roomPicker?.getAttribute("aria-controls");
      const popup = listId && document.getElementById(listId)?.closest<HTMLElement>(".ant-select-dropdown");
      setPickerExpanded(Boolean(picker));
      setPickerPopup(popup && isVisible(popup) ? popup : null);
      setSetsOpen((workingForm === "task" || workingForm === "task-set") &&
        Array.from(document.querySelectorAll<HTMLElement>('[data-learning-anchor="library-sets-open"]')).some(isVisible));
      setCovered(workDialogVisible(workingForm) || (!work && Boolean(picker) && picker !== roomPicker));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "class", "style", "hidden", "inert", "aria-hidden", "aria-expanded",
        "data-learning-anchor", "data-learning-canvas-expanded",
      ],
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("transitionend", schedule, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("transitionend", schedule, true);
      cancelAnimationFrame(frame);
    };
  }, [open, anchors, workingForm, completionAnchors, spotlightAnchors, watchRoomMode]);
  return { target, covered, positionVersion, container, dialog, guideSlot, completionMatch, pickerExpanded, pickerPopup, setsOpen,
    spotlightTarget };
}

export function LearningHelpButton() {
  const context = useContext(Help);
  const onboarding = useContext(Onboarding);
  if (!context) return null;
  return (
    <Tooltip title={context.busy ? null : "Помощь"} open={context.busy ? false : undefined} trigger={["hover", "focus"]}>
      <Button
        disabled={context.busy}
        aria-label="Помощь"
        data-learning-help="true"
        data-learning-anchor="learning-help"
        className="app-header-control"
        icon={<QuestionCircleOutlined />}
        onClick={(event) => {
          onboarding?.clearCue();
          context.open(event.currentTarget);
        }}
      />
    </Tooltip>
  );
}


function LearningHelpCue({ dismiss }: { dismiss: () => void }) {
  const { target, covered, container, positionVersion, pickerPopup } = useTourTarget(true, helpCueAnchors, "interview",
    undefined, undefined, true);
  useEffect(() => {
    if (!target || covered) return;
    target.dataset.learningHelpCue = "true";
    return () => { delete target.dataset.learningHelpCue; };
  }, [target, covered]);
  if (!target || covered) return null;
  return (
    <LearningFloatingLayer layoutVersion={positionVersion} target={target} container={container} popup={pickerPopup} compact>
      <div className={styles.tourCard} role="status">
        <strong data-learning-help-cue="true">Подсказки всегда здесь</strong>
        <p className={styles.tourDescription}>Откройте «?», чтобы вернуться к обучению.</p>
        <Button className={styles.tourActions} size="small" onClick={dismiss}>Понятно</Button>
      </div>
    </LearningFloatingLayer>
  );
}

const helpCueAnchors = ["learning-help"] as const;
