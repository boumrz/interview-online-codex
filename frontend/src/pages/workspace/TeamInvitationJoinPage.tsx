import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Alert, Box, Button, Card, Group, Loader, Stack, Text, Title } from "components/antd-compat";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { clearAuth } from "../../features/auth/authSlice";
import {
  acceptTeamInvitation,
  previewTeamInvitation,
  type TeamInvitationPreview,
  TeamInvitationRequestError,
} from "../../features/workspace/teamInvitationApi";
import {
  classifyTeamInvitationMutationFailure,
  type TeamInvitationMutationFailure,
} from "../../features/workspace/teamInvitationMutationPolicy";
import {
  clearTeamInvitationToken,
  currentTeamInvitationToken,
  preserveTeamInvitationForLogin,
} from "../../features/workspace/teamInvitationToken";
import { ThemeToggleButton } from "../../features/theme/ThemeToggleButton";
import styles from "./TeamInvitationJoinPage.module.css";

type Phase = "loading" | "ready" | "auth" | "accepting" | "accept-error" | "preview-error" | "unavailable";

function requestFailure(error: unknown): TeamInvitationMutationFailure {
  if (error instanceof TeamInvitationRequestError) {
    return {
      kind: "http",
      status: error.status,
      ...(error.code ? { code: error.code } : {}),
    };
  }
  return { kind: "network" };
}

export function TeamInvitationJoinPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const authToken = useAppSelector((state) => state.auth.token);
  const [token, setToken] = useState(() => currentTeamInvitationToken());
  const [preview, setPreview] = useState<TeamInvitationPreview | null>(null);
  const [phase, setPhase] = useState<Phase>(token ? "loading" : "unavailable");
  const [error, setError] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const acceptKeyRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const authenticationRequiredRef = useRef(false);
  const resumeAccept = new URLSearchParams(location.search).get("resume") === "accept";

  const revealScrubbedRoute = () => {
    if (window.location.pathname !== "/join/team/pending") return;
    history.replaceState(history.state, "", `/join/team${window.location.search}`);
  };

  const makeUnavailable = useCallback(() => {
    clearTeamInvitationToken();
    acceptKeyRef.current = null;
    authenticationRequiredRef.current = false;
    setToken(null);
    setPreview(null);
    setError("");
    setPhase("unavailable");
  }, []);

  useEffect(() => {
    if (authenticationRequiredRef.current && !authToken) return;
    if (!token) {
      makeUnavailable();
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setPhase("loading");
    setError("");
    void previewTeamInvitation(token, authToken ?? undefined)
      .then((result) => {
        if (generationRef.current !== generation) return;
        flushSync(() => {
          setPreview(result);
          setPhase("ready");
        });
        revealScrubbedRoute();
      })
      .catch((requestError: unknown) => {
        if (generationRef.current !== generation) return;
        if (requestError instanceof TeamInvitationRequestError && requestError.status === 410) {
          flushSync(makeUnavailable);
        } else {
          flushSync(() => {
            setError("Не удалось проверить приглашение");
            setPhase("preview-error");
          });
        }
        revealScrubbedRoute();
      });
    return () => {
      generationRef.current += 1;
    };
  }, [authToken, makeUnavailable, previewAttempt, token]);

  const accept = useCallback(async () => {
    if (!token) {
      makeUnavailable();
      return;
    }
    if (!authToken) {
      authenticationRequiredRef.current = true;
      setPhase("auth");
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const key = acceptKeyRef.current ?? crypto.randomUUID();
    acceptKeyRef.current = key;
    setError("");
    setPhase("accepting");
    try {
      const result = await acceptTeamInvitation(token, authToken, key);
      if (generationRef.current !== generation) return;
      clearTeamInvitationToken();
      acceptKeyRef.current = null;
      setToken(null);
      navigate(`/workspace/teams/${result.teamId}/interviews`, { replace: true });
    } catch (requestError) {
      if (generationRef.current !== generation) return;
      const failure = requestFailure(requestError);
      const policy = classifyTeamInvitationMutationFailure("accept", failure);
      if (failure.kind === "http" && failure.status === 410) {
        makeUnavailable();
        return;
      }
      if (!policy.preserveIntent) acceptKeyRef.current = null;
      if (policy.disposition === "authenticate") {
        authenticationRequiredRef.current = true;
        preserveTeamInvitationForLogin();
        dispatch(clearAuth());
        setPhase("auth");
        return;
      }
      setError(
        policy.disposition === "retry"
          ? "Принятие не подтверждено. Повторите действие."
          : "Не удалось принять приглашение в текущем контексте.",
      );
      setPhase("accept-error");
    }
  }, [authToken, dispatch, makeUnavailable, navigate, token]);

  const resumedRef = useRef(false);
  useEffect(() => {
    if (!resumeAccept || !authToken || phase !== "ready" || resumedRef.current) return;
    resumedRef.current = true;
    void accept();
  }, [accept, authToken, phase, resumeAccept]);

  const leaveForAuth = () => {
    if (!preserveTeamInvitationForLogin()) makeUnavailable();
  };

  return (
    <Box className={styles.page}>
      <div className={styles.themeControl}><ThemeToggleButton /></div>
      <Card className={styles.card} withBorder radius="lg" padding="xl">
        <Stack gap="lg">
          <div>
            <Text c="blue.3" size="xs" fw={800} tt="uppercase">Приглашение в команду</Text>
            <Title order={1} size="h2" mt={8}>
              {preview?.teamName ?? (phase === "unavailable" ? "Ссылка больше не действует" : "Проверяем приглашение")}
            </Title>
          </div>

          {phase === "loading" || phase === "accepting" ? (
            <Group role="status" aria-label={phase === "accepting" ? "Принимаем приглашение" : "Проверяем приглашение"}>
              <Loader size="sm" />
              <Text c="gray.5">{phase === "accepting" ? "Добавляем команду…" : "Проверяем срок и доступность…"}</Text>
            </Group>
          ) : null}

          {(phase === "ready" || phase === "accept-error") && preview ? (
            <Stack gap="md">
              <Text>Роль: Участник</Text>
              {error ? <Alert color="red" role="alert">{error}</Alert> : null}
              <Group className={styles.actions} gap="sm">
                <Button className={styles.primaryAction} onClick={() => void accept()}>
                  {phase === "accept-error" ? "Повторить принятие" : "Принять приглашение"}
                </Button>
                <Button
                  className={styles.secondaryAction}
                  variant="subtle"
                  onClick={() => {
                    makeUnavailable();
                    navigate("/", { replace: true });
                  }}
                >
                  Отменить приглашение
                </Button>
              </Group>
            </Stack>
          ) : null}

          {phase === "preview-error" ? (
            <Alert color="red" role="alert" title="Проверка не завершена">
              <Stack gap="md">
                <Text size="sm">{error}</Text>
                <Button
                  className={styles.secondaryAction}
                  variant="light"
                  onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
                >
                  Повторить проверку
                </Button>
              </Stack>
            </Alert>
          ) : null}

          {phase === "auth" ? (
            <Alert color="blue" title="Нужен аккаунт">
              <Stack gap="md">
                <Text size="sm">После входа вы вступите в команду.</Text>
                <Group className={styles.actions} gap="lg">
                  <Link className={styles.authLink} to="/login" state={{ teamInvitationReturn: true }} onClick={leaveForAuth}>Войти</Link>
                  <Link
                    className={styles.authLink}
                    to="/login"
                    state={{ teamInvitationReturn: true, initialMode: "register" }}
                    onClick={leaveForAuth}
                  >
                    Регистрация
                  </Link>
                </Group>
              </Stack>
            </Alert>
          ) : null}

          {phase === "unavailable" ? (
            <Alert color="red" role="alert" title="Приглашение недоступно">
              Ссылка истекла, была отозвана или уже использована. Попросите владельца команды создать новую.
            </Alert>
          ) : null}
        </Stack>
      </Card>
    </Box>
  );
}
