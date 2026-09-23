import React, { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "./hooks";
import { clearAuth, setCurrentUser } from "../features/auth/authSlice";
import { api, useMeProfileQuery } from "../services/api";
import { setVisitParams, trackPageView } from "../services/analytics";
import { LegacyDomainNotice } from "../components/LegacyDomainNotice";
import { normalizeLanguageKey } from "../pages/dashboard/dashboardHelpers";
import { TEAM_WORKSPACES_ENABLED } from "../config/runtime";
import { captureTeamInvitationFragment } from "../features/workspace/teamInvitationToken";

captureTeamInvitationFragment();

const LandingPage = lazy(() => import("../pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import("../pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import("../pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const PersonalWorkspacePage = lazy(() => import("../pages/workspace/PersonalWorkspacePage").then((module) => ({ default: module.PersonalWorkspacePage })));
const TeamWorkspacePage = lazy(() => import("../pages/workspace/TeamWorkspacePage").then((module) => ({ default: module.TeamWorkspacePage })));
const TeamInvitationJoinPage = lazy(() => import("../pages/workspace/TeamInvitationJoinPage").then((module) => ({ default: module.TeamInvitationJoinPage })));
const RoomPage = lazy(() => import("../pages/RoomPage").then((module) => ({ default: module.RoomPage })));

const CHUNK_RECOVERY_GUARD_KEY = "interview-online:lazy-chunk-recovery";

function isLazyChunkLoadError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /chunkloaderror|loading chunk|loading css chunk|failed to fetch dynamically imported module/i.test(message);
}

class LazyChunkRecoveryBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isLazyChunkLoadError(error)) return;

    try {
      if (window.sessionStorage.getItem(CHUNK_RECOVERY_GUARD_KEY)) return;
      window.sessionStorage.setItem(CHUNK_RECOVERY_GUARD_KEY, "1");
      window.location.reload();
    } catch {
      // If storage is unavailable, keep the original runtime error visible instead of retrying repeatedly.
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: "24px" }}>
          Не удалось загрузить интерфейс. Обновите страницу и повторите попытку.
        </div>
      );
    }
    return this.props.children;
  }
}

function ClearLazyChunkRecoveryGuard({ children }: React.PropsWithChildren) {
  useEffect(() => {
    window.sessionStorage.removeItem(CHUNK_RECOVERY_GUARD_KEY);
  }, []);

  return <>{children}</>;
}

function AuthSessionSync() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((store) => store.auth.token);
  const user = useAppSelector((store) => store.auth.user);
  const { currentData: data, error } = useMeProfileQuery(token ?? "", {
    skip: !token,
    refetchOnMountOrArgChange: true
  });

  useEffect(() => {
    if (!data) return;
    dispatch(setCurrentUser(data));
  }, [data, dispatch]);

  useEffect(() => {
    if (!token || !error || typeof error !== "object" || !("status" in error)) return;
    const status = (error as { status?: unknown }).status;
    if (status === 401 || status === 403) {
      dispatch(clearAuth());
      dispatch(api.util.resetApiState());
    }
  }, [dispatch, error, token]);

  useEffect(() => {
    setVisitParams({
      auth_status: token ? "authenticated" : "anonymous",
    });
  }, [token]);

  return null;
}

function RoutePageTracker() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname, location.search]);

  return null;
}

const LEGACY_PERSONAL_ROUTES: Record<string, string> = {
  "/dashboard": "/workspace/personal/interviews",
  "/dashboard/rooms": "/workspace/personal/interviews",
  "/dashboard/manage": "/workspace/personal/interviews",
  "/dashboard/tasks": "/workspace/personal/library",
  "/dashboard/presets": "/workspace/personal/library?tab=sets",
  "/dashboard/hr": "/workspace/personal/candidates",
};

function LegacyPersonalRedirect() {
  const location = useLocation();
  const target = LEGACY_PERSONAL_ROUTES[location.pathname] ?? "/workspace/personal/interviews";
  if (location.pathname === "/dashboard/tasks") {
    const legacy = new URLSearchParams(location.search);
    const language = legacy.get("language") ?? legacy.get("lang");
    const canonical = new URLSearchParams();
    if (language) canonical.set("language", normalizeLanguageKey(language));
    const search = canonical.toString();
    return <Navigate to={`${target}${search ? `?${search}` : ""}`} replace />;
  }
  return <Navigate to={target.includes("?") ? target : `${target}${location.search}`} replace />;
}

function PersonalWorkspaceRoute() {
  return <PersonalWorkspacePage />;
}

export function App() {
  return (
    <>
      <LegacyDomainNotice />
      <AuthSessionSync />
      <RoutePageTracker />
      <LazyChunkRecoveryBoundary>
        <Suspense fallback={<div style={{ padding: "24px" }}>Loading...</div>}>
          <ClearLazyChunkRecoveryGuard>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/dashboard" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/rooms" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/manage" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/tasks" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/presets" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/hr" element={<LegacyPersonalRedirect />} />
              <Route path="/dashboard/:section" element={<DashboardPage />} />
              <Route path="/workspace/personal/*" element={<PersonalWorkspaceRoute />} />
              <Route
                path="/workspace/teams/:teamId/*"
                element={TEAM_WORKSPACES_ENABLED ? <TeamWorkspacePage /> : <Navigate to="/workspace/personal/interviews" replace />}
              />
              <Route path="/profile" element={<PersonalWorkspacePage />} />
              <Route path="/join/team/*" element={<TeamInvitationJoinPage />} />
              <Route path="/room/:inviteCode" element={<RoomPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ClearLazyChunkRecoveryGuard>
        </Suspense>
      </LazyChunkRecoveryBoundary>
    </>
  );
}
