import React, { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "./hooks";
import { clearAuth, setCurrentUser } from "../features/auth/authSlice";
import { api, useMeProfileQuery } from "../services/api";
import { setVisitParams, trackPageView } from "../services/analytics";
import { LegacyDomainNotice } from "../components/LegacyDomainNotice";

const LandingPage = lazy(() => import("../pages/LandingPage").then((module) => ({ default: module.LandingPage })));
const LoginPage = lazy(() => import("../pages/LoginPage").then((module) => ({ default: module.LoginPage })));
const DashboardPage = lazy(() => import("../pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
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
  const { data, error } = useMeProfileQuery(undefined, {
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
              <Route path="/dashboard" element={<Navigate to="/dashboard/rooms" replace />} />
              <Route path="/dashboard/:section" element={<DashboardPage />} />
              <Route path="/room/:inviteCode" element={<RoomPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ClearLazyChunkRecoveryGuard>
        </Suspense>
      </LazyChunkRecoveryBoundary>
    </>
  );
}
