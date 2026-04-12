import React, { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "./hooks";
import { clearAuth, setCurrentUser } from "../features/auth/authSlice";
import { LandingPage } from "../pages/LandingPage";
import { RoomPage } from "../pages/RoomPage";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { api, useMeProfileQuery } from "../services/api";

function AuthSessionSync() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((store) => store.auth.token);
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

  return null;
}

export function App() {
  return (
    <>
      <AuthSessionSync />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<Navigate to="/dashboard/rooms" replace />} />
        <Route path="/dashboard/:section" element={<DashboardPage />} />
        <Route path="/room/:inviteCode" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
