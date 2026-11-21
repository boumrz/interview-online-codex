import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { store } from "../../app/store";
import { trackLearningEvent } from "../../services/analytics";
import { learningApi, useLearningCommandMutation, type LearningCommand, type LearningContext } from "./learningApi";
import type { LearningModule, LearningSource } from "./learningContent";
import { contextLearningArrival, contextLearningDestination, contextLearningSurface, type ContextSurface } from "./learningNavigation";

type ContextLocation = {
  contextSurface: ContextSurface;
  module: LearningModule;
  teamId?: string;
};

export type ContextCheckpoint = { context: LearningContext; command: LearningCommand; attempt: number; last: boolean };

type Handoff = {
  action: string;
  accountId: string;
  token: string;
  from: ContextLocation;
  pathname: string;
  arrivalPath?: string;
  checkpoint?: ContextCheckpoint;
};

type ContextActivation = { locationKey: string; accountId: string; formStep?: number; restored?: boolean; source?: LearningSource };
type ReloadMarker = { accountId: string; surface: ContextSurface; formStep?: number };
type CheckpointRetry = { pathname: string; accountId: string; retry: () => void };

const resumeKey = "interhub.context-learning";

function readReloadMarker(): ReloadMarker | undefined {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const stored = sessionStorage.getItem(resumeKey);
    return entry?.type === "reload" && stored ? JSON.parse(stored) : undefined;
  } catch {
    return undefined;
  }
}

function writeMarker(accountId?: string, surface?: ContextSurface, formStep?: number) {
  try {
    if (accountId && surface) sessionStorage.setItem(resumeKey, JSON.stringify({ accountId, surface, formStep }));
    else sessionStorage.removeItem(resumeKey);
  } catch {
    // Learning progress still persists on the server when browser storage is unavailable.
  }
}

function requestStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error ? error.status : undefined;
}

export function useContextLearningNavigation(screen: ContextLocation | undefined, accountId?: string, token?: string | null) {
  const location = useLocation();
  const navigation = useNavigationType();
  const [send] = useLearningCommandMutation();
  const [activation, setActivation] = useState<ContextActivation>();
  const [checkpointRetry, setCheckpointRetry] = useState<CheckpointRetry>();
  const handoff = useRef<Handoff>();
  const current = useRef({ pathname: location.pathname, accountId, token });
  current.current = { pathname: location.pathname, accountId, token };
  const initialPath = useRef(location.pathname);
  const observedPath = useRef(location.pathname);
  const [reload] = useState(readReloadMarker);
  const reloaded = useRef(false);
  useLayoutEffect(() => writeMarker(), []);

  const arm = useCallback((action: string, checkpoint?: ContextCheckpoint) => {
    if (!screen || !accountId || !token || !contextLearningDestination(action, screen.contextSurface)) return;
    handoff.current = { action, accountId, token, from: screen, pathname: location.pathname, checkpoint };
  }, [accountId, location.pathname, screen, token]);

  const recordOpen = useCallback((formStep?: number) => {
    if (accountId) writeMarker(accountId, contextLearningSurface(location.pathname), formStep);
  }, [accountId, location.pathname]);

  const recordClose = useCallback(() => {
    handoff.current = undefined;
    writeMarker();
  }, []);

  const consume = useCallback(() => setActivation(undefined), []);

  const startFromOffer = useCallback(() => {
    if (!screen || !accountId || !token || store.getState().auth.token !== token) return;
    const formStep = screen.contextSurface.endsWith("-create") ? 0 : undefined;
    setActivation({ locationKey: location.key, accountId, formStep, source: "offer" });
  }, [accountId, location.key, screen, token]);

  useLayoutEffect(() => {
    if (observedPath.current !== location.pathname) {
      observedPath.current = location.pathname;
      writeMarker();
      reloaded.current = true;
      setCheckpointRetry(undefined);
    }
    if (!accountId || !token) return;

    if (!reloaded.current && reload?.accountId === accountId && screen?.contextSurface === reload.surface &&
        initialPath.current === location.pathname) {
      reloaded.current = true;
      const formStep = reload.formStep !== undefined && Number.isInteger(reload.formStep) && reload.formStep >= 0
        ? reload.formStep : undefined;
      setActivation({ locationKey: location.key, accountId, formStep, restored: true });
      return;
    }

    const pending = handoff.current;
    if (!pending) return;
    if (pending.accountId !== accountId || pending.token !== token) {
      handoff.current = undefined;
      return;
    }
    if (location.pathname === pending.pathname && !pending.arrivalPath) return;
    const destination = contextLearningDestination(pending.action, pending.from.contextSurface);
    if (navigation === "POP" || contextLearningSurface(location.pathname) !== destination ||
        (pending.arrivalPath && pending.arrivalPath !== location.pathname)) {
      handoff.current = undefined;
      return;
    }
    pending.arrivalPath = location.pathname;
    if (!screen) return;
    handoff.current = undefined;
    if (!contextLearningArrival({ action: pending.action, from: pending.from.contextSurface,
      fromTeamId: pending.from.teamId, to: screen.contextSurface, toTeamId: screen.teamId })) return;

    const formStep = screen.contextSurface.endsWith("-create") ? 0 : undefined;
    setActivation({ locationKey: location.key, accountId, formStep });
    if (!pending.checkpoint || pending.checkpoint.context.module === screen.module) return;
    const { context, command, attempt, last } = pending.checkpoint;
    const pathname = location.pathname;
    const accountMatches = () => current.current.accountId === accountId && current.current.token === token &&
      store.getState().auth.token === token && localStorage.getItem("auth_token") === token;
    const destinationMatches = () => accountMatches() && current.current.pathname === pathname;
    let pendingCommand = command;
    let sending = false;
    const save = async (canReconcile = true): Promise<void> => {
      if (!destinationMatches()) return;
      const saved = await send({ context, command: pendingCommand }).unwrap().catch(async (error: unknown) => {
        if (!canReconcile || requestStatus(error) !== 409 || !destinationMatches()) throw error;
        const fresh = await store.dispatch(learningApi.endpoints.learningState.initiate(context, {
          subscribe: false, forceRefetch: true,
        })).unwrap();
        if (!destinationMatches() || fresh.version !== pendingCommand.expectedVersion ||
            fresh.attempt !== attempt || fresh.status !== "in_progress") return undefined;
        if (pendingCommand.action === "step" && fresh.completedSteps >= (pendingCommand.step ?? Infinity)) {
          return { state: fresh, events: [] };
        }
        pendingCommand = { ...pendingCommand, expectedRevision: fresh.revision };
        await save(false);
        return undefined;
      });
      if (!saved) return;
      if (!accountMatches()) return;
      for (const event of saved.events) {
        trackLearningEvent(context.module, event, { source: pendingCommand.source, attemptType: saved.state.attemptType,
          skipped: saved.state.skipped, version: saved.state.version });
      }
      if (last && pendingCommand.action === "step" && saved.state.status === "in_progress") {
        pendingCommand = { ...command, action: "finish", step: undefined,
          commandId: crypto.randomUUID(), expectedRevision: saved.state.revision };
        await save(canReconcile);
      }
    };
    const retry = () => {
      if (sending || !destinationMatches()) return;
      sending = true;
      setCheckpointRetry(undefined);
      void save().catch((error: unknown) => {
        const status = requestStatus(error);
        if (destinationMatches() && (status === 409 || !(typeof status === "number" && status >= 400 && status < 500))) {
          setCheckpointRetry({ pathname, accountId, retry });
        }
      }).finally(() => { sending = false; });
    };
    retry();
  }, [accountId, location.key, location.pathname, navigation, reload, screen, send, token]);

  const activeRequest = activation?.locationKey === location.key && activation.accountId === accountId
    ? activation : undefined;
  const arriving = handoff.current && handoff.current.pathname !== location.pathname;
  const retryCheckpoint = checkpointRetry?.pathname === location.pathname && checkpointRetry.accountId === accountId
    ? checkpointRetry.retry : undefined;
  return { arm, recordOpen, recordClose, consume, startFromOffer, activation: activeRequest, arriving: Boolean(arriving), retryCheckpoint };
}
