import React, { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Segmented, Space, Typography } from "antd";
import { KeyOutlined, UserOutlined } from "@ant-design/icons";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { store } from "../app/store";
import { API_BASE_URL, SOCIAL_AUTH_ENABLED } from "../config/runtime";
import { clearAuth, setAuthToken, setCurrentUser } from "../features/auth/authSlice";
import { api, useLoginMutation, useRegisterMutation } from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";
import { getApiErrorMessage } from "../services/apiErrors";
import { ThemeToggleButton } from "../features/theme/ThemeToggleButton";
import type { User } from "../types";
import styles from "./LoginPage.module.css";

const SocialLoginButtons = SOCIAL_AUTH_ENABLED
  ? lazy(() => import("../features/auth/SocialLoginButtons").then((module) => ({ default: module.SocialLoginButtons })))
  : null;

type AuthenticationAttempt = {
  initialToken: string | null;
  initialStoredToken: string | null;
  initialLocation: string;
  controller: AbortController;
  abortCredentials?: () => void;
};

type ProfileRetry = {
  token: string;
  draft: string;
  initialToken: string | null;
  initialStoredToken: string | null;
};

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const authToken = useAppSelector((store) => store.auth.token);
  const [mode, setMode] = useState<"login" | "register">(() => {
    const locationState = location.state;
    return locationState
      && typeof locationState === "object"
      && "initialMode" in locationState
      && locationState.initialMode === "register"
      ? "register"
      : "login";
  });
  const [nickname, setNickname] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isHr, setIsHr] = useState(false);
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordConfirmationError, setPasswordConfirmationError] = useState("");
  const [login, loginState] = useLoginMutation();
  const [register, registerState] = useRegisterMutation();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isStartingSocial, setIsStartingSocial] = useState(false);
  const [hasProfileRetry, setHasProfileRetry] = useState(false);
  const mountedRef = useRef(false);
  const attemptRef = useRef<AuthenticationAttempt | null>(null);
  const profileRetryRef = useRef<ProfileRetry | null>(null);
  const isLoading = isAuthenticating || isStartingSocial || loginState.isLoading || registerState.isLoading;
  const isRegisterMode = mode === "register";
  const credentialDraft = JSON.stringify([mode, nickname, displayName, password, passwordConfirmation, isHr]);
  const nextPath = useMemo(() => {
    const locationState = location.state;
    if (
      locationState
      && typeof locationState === "object"
      && "teamInvitationReturn" in locationState
      && locationState.teamInvitationReturn === true
    ) return "/join/team?resume=accept";
    const requested = new URLSearchParams(location.search).get("next")?.trim() ?? "";
    if (!requested.startsWith("/") || requested.startsWith("//")) return "/workspace/personal/interviews";
    return requested;
  }, [location.search, location.state]);

  useEffect(() => {
    trackEvent("mkt_login_view", { auth_status: "anonymous" });
    setVisitParams({ entrypoint: "login", auth_status: "anonymous" });
  }, [nextPath]);

  useEffect(() => {
    mountedRef.current = true;
    const cancelAttempt = () => {
      const attempt = attemptRef.current;
      attemptRef.current = null;
      profileRetryRef.current = null;
      attempt?.controller.abort();
      attempt?.abortCredentials?.();
    };
    const onPageHide = () => {
      cancelAttempt();
      setIsAuthenticating(false);
      setHasProfileRetry(false);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      cancelAttempt();
    };
  }, []);

  useEffect(() => {
    profileRetryRef.current = null;
    setHasProfileRetry(false);
  }, [credentialDraft]);

  const isCurrentAttempt = (attempt: AuthenticationAttempt) => (
    mountedRef.current
    && attemptRef.current === attempt
    && store.getState().auth.token === attempt.initialToken
    && localStorage.getItem("auth_token") === attempt.initialStoredToken
    && window.location.href === attempt.initialLocation
  );

  if (authToken) return <Navigate to={nextPath} replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (attemptRef.current || isLoading || !mountedRef.current) return;
    trackEvent(isRegisterMode ? "mkt_register_submit" : "mkt_login_submit", { nickname_len: nickname.trim().length });
    let attempt: AuthenticationAttempt | null = null;
    let issuedToken: string | null = null;
    try {
      setError("");
      setPasswordError("");
      setPasswordConfirmationError("");
      if (isRegisterMode && /[^\x20-\x7E]/.test(nickname)) {
        setError("Ник может содержать только латинские буквы, цифры и символы");
        trackEvent("mkt_register_validation_failed", { reason: "nickname_non_latin" });
        return;
      }
      if (isRegisterMode && /[^\x20-\x7E]/.test(password)) {
        setPasswordError("Пароль может содержать только латинские буквы, цифры и символы");
        trackEvent("mkt_register_validation_failed", { reason: "password_non_latin" });
        return;
      }
      if (isRegisterMode && password.length < 6) {
        const message = "Пароль должен быть не короче 6 символов";
        setPasswordError(message);
        trackEvent("mkt_register_validation_failed", { reason: "password_too_short" });
        return;
      }
      if (isRegisterMode && password !== passwordConfirmation) {
        setPasswordConfirmationError("Пароли не совпадают");
        trackEvent("mkt_register_validation_failed", { reason: "password_confirmation_mismatch" });
        return;
      }
      if (isRegisterMode && !displayName.trim()) {
        const message = "Имя обязательно";
        setError(message);
        trackEvent("mkt_register_validation_failed", { reason: "display_name_required" });
        return;
      }
      if (isRegisterMode && !nickname.trim()) {
        const message = "Ник обязателен";
        setError(message);
        trackEvent("mkt_register_validation_failed", { reason: "nickname_required" });
        return;
      }
      if (isRegisterMode && nickname.trim().length < 3) {
        const message = "Ник должен быть от 3 до 32 символов";
        setError(message);
        trackEvent("mkt_register_validation_failed", { reason: "nickname_too_short" });
        return;
      }
      if (isRegisterMode && /\s/.test(nickname.trim())) {
        const message = "Ник не должен содержать пробелы";
        setError(message);
        trackEvent("mkt_register_validation_failed", { reason: "nickname_has_space" });
        return;
      }
      attempt = {
        initialToken: store.getState().auth.token,
        initialStoredToken: localStorage.getItem("auth_token"),
        initialLocation: window.location.href,
        controller: new AbortController(),
      };
      attemptRef.current = attempt;
      setIsAuthenticating(true);
      const retry = profileRetryRef.current;
      if (retry && retry.draft === credentialDraft
        && retry.initialToken === attempt.initialToken
        && retry.initialStoredToken === attempt.initialStoredToken) {
        issuedToken = retry.token;
      } else {
        profileRetryRef.current = null;
        setHasProfileRetry(false);
        const request = isRegisterMode
          ? register({ nickname: nickname.trim(), displayName, password, isHr })
          : login({ nickname, password });
        attempt.abortCredentials = request.abort;
        issuedToken = (await request.unwrap()).token;
      }
      if (!isCurrentAttempt(attempt)) return;
      const response = await fetch(`${API_BASE_URL}/me/profile`, {
        headers: { Authorization: `Bearer ${issuedToken}` },
        credentials: "same-origin",
        cache: "no-store",
        signal: attempt.controller.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw { status: response.status, data };
      if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string"
        || !("displayName" in data) || typeof data.displayName !== "string") {
        throw { status: "PARSING_ERROR", data: null };
      }
      const freshProfile = data as User;
      if (!isCurrentAttempt(attempt)) return;
      // Publish only the confirmed session; no async work may split these writes.
      attemptRef.current = null;
      profileRetryRef.current = null;
      dispatch(clearAuth());
      dispatch(api.util.resetApiState());
      dispatch(setAuthToken(issuedToken));
      dispatch(setCurrentUser(freshProfile));
      localStorage.setItem("auth_user", JSON.stringify(freshProfile));
      localStorage.setItem("display_name", freshProfile.displayName);
      trackEvent(isRegisterMode ? "mkt_register_success" : "mkt_login_success", { auth_status: "authenticated" });
      navigate(nextPath, { replace: true });
    } catch (err) {
      if (!attempt || !isCurrentAttempt(attempt)) return;
      if (issuedToken) {
        // A retry checks the issued session again without duplicating registration.
        profileRetryRef.current = {
          token: issuedToken,
          draft: credentialDraft,
          initialToken: attempt.initialToken,
          initialStoredToken: attempt.initialStoredToken,
        };
        setHasProfileRetry(true);
      }
      dispatch(clearAuth());
      dispatch(api.util.resetApiState());
      const apiMessage = getApiErrorMessage(err, isRegisterMode
        ? "Не удалось создать аккаунт. Попробуйте ещё раз."
        : "Не удалось выполнить вход. Проверьте ник и пароль.");
      if (isRegisterMode) {
        const registerMessage = apiMessage || "Не удалось зарегистрироваться. Проверьте данные и попробуйте снова.";
        setError(registerMessage);
        if (registerMessage.toLowerCase().includes("пароль")) setPasswordError(registerMessage);
        trackEvent("mkt_register_failed", { has_api_message: Boolean(apiMessage) });
        return;
      }
      setError(apiMessage || "Не удалось выполнить вход. Проверьте ник и пароль.");
      trackEvent("mkt_login_failed", { has_api_message: Boolean(apiMessage) });
    } finally {
      if (attempt && attemptRef.current === attempt) {
        if (!isCurrentAttempt(attempt)) {
          profileRetryRef.current = null;
          if (mountedRef.current) setHasProfileRetry(false);
        }
        attemptRef.current = null;
        if (mountedRef.current) setIsAuthenticating(false);
      }
    }
  };

  const onModeChange = (value: string) => {
    if (attemptRef.current || isLoading) return;
    setMode(value as "login" | "register");
    setError("");
    setPasswordError("");
    setPasswordConfirmation("");
    setPasswordConfirmationError("");
    trackEvent("mkt_auth_mode_changed", { mode: value });
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="На главную страницу InterHub">
          <span className={styles.brandMark}><KeyOutlined aria-hidden="true" /></span>
          <span>InterHub</span>
        </Link>
        <ThemeToggleButton />
      </header>
      <section className={styles.content}>
        <h1 className="visually-hidden">Личный кабинет — вход и регистрация</h1>
        <Card className={styles.card}>
          <Space orientation="vertical" size={8} className={styles.intro}>
            <Typography.Title level={2}>Личный кабинет</Typography.Title>
          </Space>

          <Segmented
            aria-label="Режим авторизации"
            block
            disabled={isLoading}
            onChange={onModeChange}
            options={[{ label: "Вход", value: "login" }, { label: "Регистрация", value: "register" }]}
            value={mode}
          />

          <form className={styles.form} onSubmit={onSubmit}>
            {isRegisterMode ? (
              <>
                <label className={styles.field}>
                  <span>Ник</span>
                  <Input placeholder="Введите ник для входа" aria-label="Ник" autoComplete="username" disabled={isLoading} prefix={<UserOutlined />} value={nickname} onChange={(event) => setNickname(event.currentTarget.value)} required />
                </label>
                <label className={styles.field}>
                  <span>Имя</span>
                  <Input aria-label="Имя" autoComplete="name" disabled={isLoading} prefix={<UserOutlined />} value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} required />
                </label>
              </>
            ) : (
              <label className={styles.field}>
                <span>Ник</span>
                <Input placeholder="Введите ник для входа" aria-label="Ник" autoComplete="username" disabled={isLoading} prefix={<UserOutlined />} value={nickname} onChange={(event) => setNickname(event.currentTarget.value)} required />
              </label>
            )}
            <label className={styles.field}>
              <span>Пароль</span>
              <Input.Password
                placeholder={isRegisterMode ? "Придумайте пароль: минимум 6 символов" : "Введите пароль вашего аккаунта"}
                autoComplete={isRegisterMode ? "new-password" : "current-password"}
                aria-label="Пароль"
                disabled={isLoading}
                prefix={<KeyOutlined />}
                value={password}
                onChange={(event) => {
                  const nextPassword = event.currentTarget.value;
                  setPassword(nextPassword);
                  setPasswordError("");
                  setPasswordConfirmationError("");
                }}
                required
              />
              {passwordError && <Typography.Text role="alert" type="danger">{passwordError}</Typography.Text>}
            </label>
            {isRegisterMode && (
              <label className={styles.field}>
                <span>Повторите пароль</span>
                <Input.Password
                  placeholder="Повторите пароль"
                  autoComplete="new-password"
                  aria-label="Повторите пароль"
                  disabled={isLoading}
                  prefix={<KeyOutlined />}
                  value={passwordConfirmation}
                  onChange={(event) => {
                    setPasswordConfirmation(event.currentTarget.value);
                    setPasswordConfirmationError("");
                  }}
                  required
                />
                {passwordConfirmationError && <Typography.Text role="alert" type="danger">{passwordConfirmationError}</Typography.Text>}
              </label>
            )}
            {isRegisterMode && (
              <div className={styles.checkboxField}>
                <Checkbox checked={isHr} disabled={isLoading} onChange={(event) => setIsHr(event.target.checked)}>
                  Я нанимающий
                </Checkbox>
              </div>
            )}
            <Button block htmlType="submit" loading={isLoading} disabled={isLoading} aria-busy={isLoading} aria-label={hasProfileRetry ? "Повторить" : isRegisterMode ? "Создать аккаунт" : "Войти в кабинет"} size="large" type="primary">
              {hasProfileRetry ? "Повторить" : isRegisterMode ? "Создать аккаунт" : "Войти в кабинет"}
            </Button>
            <div className={styles.feedback} aria-live="polite">
              {error && <Alert showIcon type="error" message={error} />}
            </div>
          </form>

          {SocialLoginButtons && (
            <Suspense fallback={null}>
              <SocialLoginButtons disabled={isLoading} invitationReturn={nextPath === "/join/team?resume=accept"}
                onError={setError} onBusyChange={setIsStartingSocial} />
            </Suspense>
          )}

          <Link className={styles.homeLink} to="/">На главную страницу</Link>
        </Card>
      </section>
    </main>
  );
}
