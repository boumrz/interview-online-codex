import React, { FormEvent, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Input, Space, Spin, Typography } from "antd";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { store } from "../app/store";
import { API_BASE_URL } from "../config/runtime";
import { clearAuth, setAuthToken, setCurrentUser } from "../features/auth/authSlice";
import { ThemeToggleButton } from "../features/theme/ThemeToggleButton";
import { api } from "../services/api";
import { getApiErrorMessage } from "../services/apiErrors";
import { readPending, socialRequest, SOCIAL_INVITATION_RETURN_KEY, SocialPending } from "../services/socialAuth";
import type { User } from "../types";
import styles from "./LoginPage.module.css";

type Attempt = {
  controller: AbortController;
  token: string | null;
  storedToken: string | null;
  location: string;
};

export function SocialLoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authToken = useAppSelector((state) => state.auth.token);
  const [initialResult] = useState(() => new URLSearchParams(window.location.search).get("result"));
  const [pending, setPending] = useState<SocialPending | null>(null);
  const [loading, setLoading] = useState(!initialResult);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"register" | "link">("register");
  const [nickname, setNickname] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [isHr, setIsHr] = useState(false);
  const [error, setError] = useState(initialResult === "cancelled" ? "Вход отменён."
    : initialResult ? "Не удалось выполнить вход. Попробуйте ещё раз." : "");
  const [retryProfile, setRetryProfile] = useState(false);
  const [canRetryPending, setCanRetryPending] = useState(false);
  const [pendingReload, setPendingReload] = useState(0);
  const mounted = useRef(false);
  const attempt = useRef<Attempt | null>(null);
  const issued = useRef<string | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);
  const nextPath = sessionStorage.getItem(SOCIAL_INVITATION_RETURN_KEY) === "1"
    ? "/join/team?resume=accept" : "/workspace/personal/interviews";

  const current = (value: Attempt) => mounted.current && attempt.current === value
    && !value.controller.signal.aborted && store.getState().auth.token === value.token
    && localStorage.getItem("auth_token") === value.storedToken && window.location.href === value.location;

  useEffect(() => {
    mounted.current = true;
    const cancel = () => {
      attempt.current?.controller.abort();
      attempt.current = null;
      issued.current = null;
      pendingRequest.current?.abort();
      pendingRequest.current = null;
    };
    const onPageHide = () => {
      const interrupted = Boolean(attempt.current || pendingRequest.current || issued.current);
      cancel();
      setBusy(false);
      setRetryProfile(false);
      if (interrupted) {
        setPending(null);
        setLoading(false);
        setCanRetryPending(false);
        setError("Вход прерван. Начните вход заново.");
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mounted.current = false;
      cancel();
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    if (authToken || initialResult) return;
    const controller = new AbortController();
    pendingRequest.current = controller;
    const initialToken = store.getState().auth.token;
    const initialStored = localStorage.getItem("auth_token");
    const initialLocation = window.location.href;
    const valid = () => mounted.current && !controller.signal.aborted
      && store.getState().auth.token === initialToken && localStorage.getItem("auth_token") === initialStored
      && window.location.href === initialLocation;
    setLoading(true);
    setCanRetryPending(false);
    // A cancellable task also avoids consuming a flow in StrictMode's first effect pass.
    const timer = window.setTimeout(() => {
      socialRequest<unknown>("/pending", controller.signal).then(async (data) => {
        if (!valid()) return;
        const value = readPending(data);
        setPending(value);
        setDisplayName(value.displayName);
        setLoading(false);
        if (pendingRequest.current === controller) pendingRequest.current = null;
        if (value.accountExists) await authenticate("complete", {});
      }).catch((cause) => {
        if (!valid()) return;
        setError(getApiErrorMessage(cause, "Не удалось продолжить вход. Начните вход заново."));
        const status = cause && typeof cause === "object" && "status" in cause ? cause.status : null;
        setCanRetryPending(status !== 401 && status !== 403 && status !== 404);
        setLoading(false);
        if (pendingRequest.current === controller) pendingRequest.current = null;
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (pendingRequest.current === controller) pendingRequest.current = null;
    };
  }, [authToken, initialResult, pendingReload]);

  const authenticate = async (operation: "complete" | "link", body: unknown) => {
    if (!mounted.current || attempt.current) return;
    const value: Attempt = {
      controller: new AbortController(), token: store.getState().auth.token,
      storedToken: localStorage.getItem("auth_token"), location: window.location.href,
    };
    attempt.current = value;
    setBusy(true);
    setError("");
    try {
      if (!issued.current) {
        const response = await socialRequest<unknown>(`/${operation}`, value.controller.signal, body);
        if (!current(value)) return;
        if (!response || typeof response !== "object" || !("token" in response)
          || typeof response.token !== "string" || !response.token.trim()) throw { status: "PARSING_ERROR" };
        issued.current = response.token;
      }
      const token = issued.current;
      const controller = new AbortController();
      const abort = () => controller.abort();
      value.controller.signal.addEventListener("abort", abort, { once: true });
      const timer = window.setTimeout(abort, 15_000);
      let profile: User;
      try {
        const response = await fetch(`${API_BASE_URL}/me/profile`, {
          headers: { Authorization: `Bearer ${token}` }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (!response.ok) throw { status: response.status, data };
        if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string"
          || !("nickname" in data) || typeof data.nickname !== "string"
          || !("displayName" in data) || typeof data.displayName !== "string") throw { status: "PARSING_ERROR" };
        profile = data as User;
      } catch (cause) {
        if (controller.signal.aborted && !value.controller.signal.aborted) throw { status: "TIMEOUT_ERROR" };
        throw cause;
      } finally {
        window.clearTimeout(timer);
        value.controller.signal.removeEventListener("abort", abort);
      }
      if (!current(value)) return;
      attempt.current = null;
      issued.current = null;
      sessionStorage.removeItem(SOCIAL_INVITATION_RETURN_KEY);
      dispatch(clearAuth());
      dispatch(api.util.resetApiState());
      dispatch(setAuthToken(token));
      dispatch(setCurrentUser(profile));
      localStorage.setItem("auth_user", JSON.stringify(profile));
      localStorage.setItem("display_name", profile.displayName);
      navigate(nextPath, { replace: true });
    } catch (cause) {
      if (!current(value)) return;
      const record = cause && typeof cause === "object" ? cause as Record<string, unknown> : null;
      const status = record?.status;
      if (issued.current) {
        if (status === 401 || status === 403) {
          issued.current = null;
          setRetryProfile(false);
          setPending(null);
          setCanRetryPending(false);
          setError("Сессия недействительна. Начните вход заново.");
          return;
        }
        setRetryProfile(true);
      } else {
        const data = record?.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
        if (data?.code === "SOCIAL_AUTH_EXPIRED" || data?.code === "SOCIAL_AUTH_INVALID") {
          setPending(null);
          setCanRetryPending(false);
        }
      }
      setError(getApiErrorMessage(cause, "Не удалось выполнить вход. Попробуйте ещё раз."));
    } finally {
      if (attempt.current === value) {
        if (!current(value)) { issued.current = null; if (mounted.current) setRetryProfile(false); }
        attempt.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !pending) return;
    if (retryProfile || pending.accountExists) { void authenticate("complete", {}); return; }
    if (mode === "register") {
      const nick = nickname.trim();
      if (/[^\x20-\x7E]/.test(nick)) {
        setError("Ник может содержать только латинские буквы, цифры и символы"); return;
      }
      if (nick.length < 3 || nick.length > 32) { setError("Ник должен быть от 3 до 32 символов"); return; }
      if (/\s/.test(nick)) { setError("Ник не должен содержать пробелы"); return; }
      if (displayName.trim().length < 2 || displayName.trim().length > 64) {
        setError("Имя должно быть от 2 до 64 символов"); return;
      }
      void authenticate("complete", { nickname: nick, displayName: displayName.trim(), isHr });
    } else void authenticate("link", { nickname: nickname.trim(), password });
  };

  if (authToken) return <Navigate to={nextPath} replace />;
  const submitLabel = retryProfile || pending?.accountExists ? "Повторить"
    : mode === "link" ? "Привязать и войти" : "Создать аккаунт";
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}><span className={styles.brandMark}>IH</span>InterHub</Link>
        <ThemeToggleButton />
      </header>
      <section className={styles.content}>
        <Card className={styles.card}>
          <Typography.Title level={2}>{pending && !pending.accountExists
            ? mode === "link" ? "Привязать аккаунт" : "Завершить регистрацию" : "Вход в InterHub"}</Typography.Title>
          {loading && <Spin aria-label="Проверка входа" />}
          {pending && (
            <form className={styles.form} onSubmit={submit}>
              {!pending.accountExists && <>
                <label className={styles.field}><span>Ник</span>
                  <Input aria-label="Ник" autoComplete="username" placeholder="Введите ник для входа"
                    required disabled={busy || retryProfile} value={nickname} onChange={(event) => setNickname(event.target.value)} />
                </label>
                {mode === "register" ? <>
                  <label className={styles.field}><span>Имя</span>
                    <Input aria-label="Имя" autoComplete="name" required disabled={busy || retryProfile}
                      value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                  </label>
                  <Checkbox disabled={busy || retryProfile} checked={isHr} onChange={(event) => setIsHr(event.target.checked)}>Я нанимающий</Checkbox>
                </> : <label className={styles.field}><span>Пароль</span>
                  <Input.Password aria-label="Пароль" autoComplete="current-password" placeholder="Введите пароль вашего аккаунта"
                    required disabled={busy || retryProfile} value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>}
              </>}
              <Button type="primary" block htmlType="submit" loading={busy} disabled={busy} aria-busy={busy} aria-label={submitLabel}>
                {submitLabel}
              </Button>
              {!pending.accountExists && !retryProfile && <Button disabled={busy} onClick={() => {
                setMode(mode === "register" ? "link" : "register"); setPassword(""); setError("");
              }}>{mode === "register" ? "У меня есть аккаунт" : "Создать новый аккаунт"}</Button>}
            </form>
          )}
          {error && <Alert role="alert" showIcon type={initialResult === "cancelled" ? "info" : "error"} message={error} />}
          {!pending && !loading && canRetryPending && <Button onClick={() => { setError(""); setPendingReload((value) => value + 1); }}>Повторить</Button>}
          <Space orientation="vertical" align="center" style={{ width: "100%" }}>
            <Link to="/login">Начать вход заново</Link>
            <Link to="/">На главную страницу</Link>
          </Space>
        </Card>
      </section>
    </main>
  );
}
