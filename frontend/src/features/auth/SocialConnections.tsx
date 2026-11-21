import React, { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Spin, Typography } from "antd";
import { CheckCircleFilled, GithubFilled } from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { store } from "../../app/store";
import { getApiErrorMessage } from "../../services/apiErrors";
import { readAuthorizationUrl, readConnections, readProfileLinkResult, socialRequest, type SocialConnection, type SocialProvider } from "../../services/socialAuth";
import styles from "./SocialConnections.module.css";

type Props = { token: string; userId: string };
type Scope = Props & { pathname: string; active: boolean };
type Notice = { type: "success" | "info" | "error"; text: string };
type UnlinkConfirmation = { provider: SocialProvider; requiresPassword: boolean; error?: string };
type UnlinkPasswordFields = { newPassword: string; confirmation: string };
const providerName = (provider: SocialProvider) => provider === "google" ? "Google" : "GitHub";
const lastMethodMessage = "Подключите другой способ входа или воспользуйтесь действующим паролем InterHub.";

function hasErrorCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "data" in error && error.data
    && typeof error.data === "object" && "code" in error.data && error.data.code === code);
}

export function SocialConnections({ token, userId }: Props) {
  const headingId = useId();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const scope = useRef<Scope | null>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const action = useRef<{ controller: AbortController; kind: "start" | "complete" | "unlink" } | null>(null);
  const restoreHeadingFocus = useRef(false);
  const [connections, setConnections] = useState<SocialConnection[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [starting, setStarting] = useState<SocialProvider | null>(null);
  const [completing, setCompleting] = useState(false);
  const [canRetryCompletion, setCanRetryCompletion] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const [unlinkConfirmation, setUnlinkConfirmation] = useState<UnlinkConfirmation | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [passwordForm] = Form.useForm<UnlinkPasswordFields>();

  const current = (captured: Scope, controller?: AbortController) => {
    const auth = store.getState().auth;
    return captured.active && scope.current === captured && !controller?.signal.aborted
      && auth.token === captured.token && auth.user?.id === captured.userId
      && localStorage.getItem("auth_token") === captured.token && window.location.pathname === captured.pathname;
  };

  const load = async (captured: Scope) => {
    if (!current(captured)) return;
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setConnections(null);
    setLoadError("");
    try {
      const data = await socialRequest<unknown>("/connections", controller.signal, undefined,
        { Authorization: `Bearer ${captured.token}` });
      if (current(captured, controller)) setConnections(readConnections(data));
    } catch (error) {
      if (current(captured, controller)) setLoadError(getApiErrorMessage(error, "Не удалось загрузить способы входа. Повторите попытку."));
    } finally {
      if (loadRequest.current === controller) loadRequest.current = null;
    }
  };

  const complete = async (captured: Scope) => {
    if (!current(captured) || action.current) return;
    const controller = new AbortController();
    action.current = { controller, kind: "complete" };
    setCompleting(true);
    setCanRetryCompletion(false);
    setNotice(null);
    try {
      const data = await socialRequest<unknown>("/profile-link/complete", controller.signal, {},
        { Authorization: `Bearer ${captured.token}` });
      if (!current(captured, controller)) return;
      const provider = readProfileLinkResult(data);
      setNotice({ type: "success", text: `${providerName(provider)} привязан. Можно использовать его для входа.` });
      void load(captured);
    } catch (error) {
      if (!current(captured, controller)) return;
      setNotice({ type: "error", text: hasErrorCode(error, "SOCIAL_IDENTITY_CONFLICT")
        ? "Этот аккаунт уже привязан к другому профилю InterHub. Сначала отвяжите его в том профиле."
        : getApiErrorMessage(error, "Не удалось завершить привязку. Попробуйте ещё раз.") });
      const status = error && typeof error === "object" && "status" in error ? error.status : null;
      setCanRetryCompletion(status !== 400 && status !== 401 && status !== 403 && status !== 404 && status !== 409);
    } finally {
      if (action.current?.controller === controller) {
        action.current = null;
        if (current(captured, controller)) setCompleting(false);
      }
    }
  };

  const start = async (provider: SocialProvider) => {
    const captured = scope.current;
    if (!captured || !current(captured) || action.current) return;
    const controller = new AbortController();
    action.current = { controller, kind: "start" };
    setStarting(provider);
    setCanRetryCompletion(false);
    setNotice(null);
    let redirecting = false;
    try {
      const data = await socialRequest<unknown>(`/${provider}/profile-link/start`, controller.signal, {},
        { Authorization: `Bearer ${captured.token}` });
      if (!current(captured, controller)) return;
      const url = readAuthorizationUrl(data, provider);
      redirecting = true;
      window.location.assign(url);
    } catch (error) {
      redirecting = false;
      if (current(captured, controller)) setNotice({ type: "error", text: getApiErrorMessage(error, "Не удалось начать подключение. Попробуйте ещё раз.") });
    } finally {
      if (!redirecting && action.current?.controller === controller) {
        action.current = null;
        if (current(captured, controller)) setStarting(null);
      }
    }
  };

  const unlink = async (confirmation: UnlinkConfirmation, newPassword?: string) => {
    const { provider, requiresPassword } = confirmation;
    const captured = scope.current;
    if (!captured || !current(captured) || action.current
      || !connections?.some((connection) => connection.provider === provider && connection.linked)) return;
    const controller = new AbortController();
    action.current = { controller, kind: "unlink" };
    setUnlinking(true);
    setUnlinkConfirmation({ provider, requiresPassword });
    setCanRetryCompletion(false);
    setNotice(null);
    try {
      const data = await socialRequest<unknown>(`/${provider}/unlink`, controller.signal, requiresPassword ? { newPassword } : {},
        { Authorization: `Bearer ${captured.token}` });
      if (!current(captured, controller)) return;
      const next = readConnections(data);
      if (next.some((connection) => connection.provider === provider && connection.linked)) throw { status: "PARSING_ERROR" };
      setConnections(next);
      restoreHeadingFocus.current = true;
      setUnlinkConfirmation(null);
      setNotice({ type: "success", text: `${providerName(provider)} отвязан.` });
    } catch (error) {
      if (!current(captured, controller)) return;
      if (hasErrorCode(error, "SOCIAL_PASSWORD_REQUIRED")) {
        setUnlinkConfirmation({ provider, requiresPassword: true });
      } else if (hasErrorCode(error, "SOCIAL_PASSWORD_ALREADY_SET") || hasErrorCode(error, "SOCIAL_CONNECTION_CHANGED")
        || hasErrorCode(error, "SOCIAL_LAST_SIGN_IN_METHOD")) {
        restoreHeadingFocus.current = true;
        setUnlinkConfirmation(null);
        setNotice({ type: "error", text: getApiErrorMessage(error, "Проверьте способы входа и повторите отвязку.") });
        void load(captured);
      } else {
        setUnlinkConfirmation({ provider, requiresPassword, error: getApiErrorMessage(error, "Не удалось отвязать аккаунт. Повторите попытку.") });
      }
    } finally {
      if (action.current?.controller === controller) {
        action.current = null;
        if (current(captured, controller)) setUnlinking(false);
      }
    }
  };

  useEffect(() => {
    const captured: Scope = { token, userId, pathname, active: true };
    scope.current = captured;
    setConnections(null);
    setLoadError("");
    setSessionChanged(false);
    setNotice(null);
    setStarting(null);
    setCompleting(false);
    setCanRetryCompletion(false);
    setUnlinkConfirmation(null);
    setUnlinking(false);
    const cancel = () => {
      loadRequest.current?.abort();
      loadRequest.current = null;
      action.current?.controller.abort();
      action.current = null;
    };
    const changed = () => {
      if (current(captured)) return;
      captured.active = false;
      cancel();
      setConnections(null);
      setLoadError("");
      setNotice(null);
      setSessionChanged(true);
      setStarting(null);
      setCompleting(false);
      setCanRetryCompletion(false);
      setUnlinkConfirmation(null);
      setUnlinking(false);
    };
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === "auth_token") changed(); };
    // Defer consuming the callback until StrictMode's setup/cleanup probe has finished.
    const timer = window.setTimeout(() => {
      if (!current(captured)) { changed(); return; }
      const query = new URLSearchParams(window.location.search);
      const result = query.get("social_link");
      if (query.has("social_link")) {
        query.delete("social_link");
        navigate({ pathname, search: query.toString(), hash: window.location.hash }, { replace: true });
      }
      void load(captured);
      if (result === "ready") void complete(captured);
      if (result === "cancelled") setNotice({ type: "info", text: "Подключение отменено. Можно попробовать снова в любой момент." });
      if (result === "failed") setNotice({ type: "error", text: "Не удалось подтвердить аккаунт. Начните подключение заново." });
    }, 0);
    const onPageHide = () => {
      window.clearTimeout(timer);
      const interruptedCompletion = action.current?.kind === "complete";
      cancel();
      setStarting(null);
      setCompleting(false);
      setUnlinkConfirmation(null);
      setUnlinking(false);
      if (interruptedCompletion) setCanRetryCompletion(true);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (current(captured)) void load(captured);
      else changed();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      captured.active = false;
      window.clearTimeout(timer);
      cancel();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [token, userId, pathname, navigate]);

  const busy = Boolean(starting) || completing || unlinking;
  const unlinkProvider = unlinkConfirmation?.provider;
  const unlinkProviderName = unlinkProvider ? providerName(unlinkProvider) : "";
  const unlinkActionLabel = unlinkConfirmation?.requiresPassword ? "Задать пароль и отвязать" : "Отвязать";

  if (connections?.every(({ available, linked }) => !available && !linked)
    && !notice && !sessionChanged && !loadError && !completing) return null;

  return <section aria-labelledby={headingId}>
    <Card className={styles.panel}>
      <Typography.Title id={headingId} level={2} tabIndex={-1} className={styles.heading}>Способы входа</Typography.Title>
      <Typography.Paragraph className={styles.description}>Подключите Google или GitHub, чтобы входить в этот же аккаунт.</Typography.Paragraph>
      {sessionChanged ? <Alert type="warning" role="alert" title="Сессия изменилась. Обновите страницу, чтобы увидеть способы входа текущего аккаунта."
        action={<Button onClick={() => window.location.reload()}>Обновить страницу</Button>} /> : <>
        {notice ? <Alert className={styles.notice} type={notice.type} showIcon role={notice.type === "error" ? "alert" : "status"} title={notice.text}
          action={canRetryCompletion ? <Button onClick={() => { if (scope.current) void complete(scope.current); }}>Повторить привязку</Button> : undefined} /> : null}
        {completing ? <div className={styles.loading} role="status"><Spin size="small" /> Подтверждаем привязку…</div> : null}
        {loadError ? <Alert type="error" role="alert" title={loadError} action={<Button onClick={() => { if (scope.current) void load(scope.current); }}>Повторить загрузку</Button>} />
          : connections === null ? <div className={styles.loading} role="status"><Spin size="small" /> Загружаем способы входа…</div>
            : <div className={styles.rows}>{connections.map(({ provider, linked, available, canUnlink, requiresPassword }) => <div key={provider} role="group" aria-label={providerName(provider)} className={styles.row}>
              <div className={styles.provider}>
                <span className={styles.icon} aria-hidden="true">{provider === "google" ? <img src="/auth/google-g.png" alt="" width={22} height={22} /> : <GithubFilled style={{ fontSize: 24 }} />}</span>
                <div><span className={styles.name}>{providerName(provider)}</span>
                  <span className={`${styles.status} ${linked ? styles.linked : ""}`}>{linked ? <><CheckCircleFilled aria-hidden="true" /> Привязан</> : "Не привязан"}</span>
                  {!available ? <span className={styles.unavailable}>Временно недоступен</span> : null}
                  {requiresPassword ? <span className={styles.unavailable}>Для отвязки нужно задать пароль InterHub.</span>
                    : linked && !canUnlink ? <span className={styles.unavailable}>{lastMethodMessage}</span> : null}
                </div>
              </div>
              {!linked && available ? <Button loading={starting === provider} disabled={busy}
                onClick={() => void start(provider)}>Подключить {providerName(provider)}</Button>
                : canUnlink || requiresPassword ? <Button danger disabled={busy} onClick={() => setUnlinkConfirmation({ provider, requiresPassword })}>
                  Отвязать {providerName(provider)}
                </Button> : null}
            </div>)}</div>}
      </>}
      <Modal open={Boolean(unlinkProvider) && !sessionChanged} title={`Отвязать ${unlinkProviderName}?`} centered destroyOnHidden
        okText={unlinkActionLabel} cancelText="Отмена"
        okButtonProps={{ danger: true, disabled: unlinking, "aria-label": unlinkActionLabel }}
        cancelButtonProps={{ disabled: unlinking }}
        confirmLoading={unlinking} closable={!unlinking} keyboard={!unlinking} mask={{ closable: !unlinking }}
        onCancel={() => { if (!action.current) setUnlinkConfirmation(null); }}
        onOk={() => {
          if (!unlinkConfirmation) return;
          if (unlinkConfirmation.requiresPassword) passwordForm.submit();
          else void unlink(unlinkConfirmation);
        }}
        afterClose={() => {
          if (!restoreHeadingFocus.current) return;
          restoreHeadingFocus.current = false;
          document.getElementById(headingId)?.focus();
        }}>
        <Typography.Paragraph>Вход через {unlinkProviderName} для этого профиля станет недоступен. Ваши данные и текущая сессия сохранятся.</Typography.Paragraph>
        {unlinkConfirmation?.requiresPassword ? <>
          <Typography.Paragraph>Задайте пароль, чтобы входить в InterHub по нику и паролю.</Typography.Paragraph>
          <Form form={passwordForm} layout="vertical" clearOnDestroy disabled={unlinking}
            onFinish={({ newPassword }) => void unlink(unlinkConfirmation, newPassword)}>
            <Form.Item name="newPassword" label="Новый пароль InterHub" rules={[
              { required: true, whitespace: true, message: "Укажите пароль" },
              { min: 6, max: 72, message: "Пароль должен содержать от 6 до 72 символов" },
              { pattern: /^[\x20-\x7e]+$/, message: "Пароль может содержать только латинские буквы, цифры и символы" },
            ]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="confirmation" label="Повторите новый пароль" dependencies={["newPassword"]} rules={[
              { required: true, message: "Повторите пароль" },
              ({ getFieldValue }) => ({
                validator: (_, value) => !value || value === getFieldValue("newPassword")
                  ? Promise.resolve() : Promise.reject(new Error("Пароли не совпадают")),
              }),
            ]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </Form>
        </> : null}
        {unlinkConfirmation?.error ? <Alert role="alert" type="error" showIcon title={unlinkConfirmation.error} /> : null}
      </Modal>
    </Card>
  </section>;
}
