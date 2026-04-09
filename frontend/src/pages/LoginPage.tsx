import React, { FormEvent, useMemo, useState } from "react";
import {
  Anchor,
  Box,
  Button,
  Card,
  Container,
  Group,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title
} from "@mantine/core";
import { IconKey, IconUser } from "@tabler/icons-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { setAuth } from "../features/auth/authSlice";
import { useLoginMutation, useRegisterMutation } from "../services/api";

const fieldStyles = {
  label: { color: "#9ba0a8", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    backgroundColor: "#14171d",
    borderColor: "#272b34",
    color: "#f3f5f7"
  }
};

export function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const authToken = useAppSelector((store) => store.auth.token);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [login, loginState] = useLoginMutation();
  const [register, registerState] = useRegisterMutation();
  const isLoading = loginState.isLoading || registerState.isLoading;
  const isRegisterMode = mode === "register";
  const feedbackText = error || " ";
  const nextPath = useMemo(() => {
    const requested = new URLSearchParams(location.search).get("next")?.trim() ?? "";
    if (!requested.startsWith("/") || requested.startsWith("//")) {
      return "/dashboard/rooms";
    }
    return requested;
  }, [location.search]);

  if (authToken) {
    return <Navigate to={nextPath} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      setPasswordError("");
      if (isRegisterMode && password.length < 6) {
        const passwordValidationError = "Пароль должен быть не короче 6 символов";
        setPasswordError(passwordValidationError);
        setError(passwordValidationError);
        return;
      }
      if (isRegisterMode && !displayName.trim()) {
        const displayNameValidationError = "Имя обязательно";
        setError(displayNameValidationError);
        return;
      }
      if (isRegisterMode && !nickname.trim()) {
        const nicknameValidationError = "Ник обязателен";
        setError(nicknameValidationError);
        return;
      }
      if (isRegisterMode && nickname.trim().length < 3) {
        const nicknameValidationError = "Ник должен быть от 3 до 32 символов";
        setError(nicknameValidationError);
        return;
      }
      if (isRegisterMode && /\s/.test(nickname.trim())) {
        const nicknameValidationError = "Ник не должен содержать пробелы";
        setError(nicknameValidationError);
        return;
      }
      const auth = isRegisterMode
        ? await register({ nickname: nickname.trim(), displayName, password }).unwrap()
        : await login({ nickname, password }).unwrap();
      dispatch(setAuth(auth));
      navigate(nextPath, { replace: true });
    } catch (err) {
      const apiMessage = extractApiErrorMessage(err);
      if (isRegisterMode) {
        const registerMessage = apiMessage || "Не удалось зарегистрироваться. Проверьте данные и попробуйте снова.";
        setError(registerMessage);
        if (registerMessage.toLowerCase().includes("пароль")) {
          setPasswordError(registerMessage);
        }
        return;
      }
      setError(apiMessage || "Не удалось выполнить вход. Проверьте ник и пароль.");
    }
  };

  return (
    <Box style={{ minHeight: "100vh", background: "#0f1115", display: "flex", alignItems: "center" }}>
      <Container size="xs" py={40}>
        <Card
          withBorder
          radius="lg"
          padding="xl"
          bg="#11151c"
          c="gray.1"
          style={{ borderColor: "#272b34", width: "100%", maxWidth: 460 }}
        >
          <Stack>
            <Group justify="space-between">
              <Group>
                <ThemeIcon color="gray" variant="light">
                  <IconUser size={16} />
                </ThemeIcon>
                <Title order={3} c="#f3f5f7">
                  Личный кабинет
                </Title>
              </Group>
            </Group>

            <Text c="#8b919b" size="sm">
              Вход по нику и паролю. При регистрации укажите ник и имя для комнаты.
            </Text>

            <SegmentedControl
              value={mode}
              onChange={(value) => {
                setMode(value as "login" | "register");
                setError("");
                setPasswordError("");
              }}
              fullWidth
              data={[
                { label: "Вход", value: "login" },
                { label: "Регистрация", value: "register" }
              ]}
            />

            <form onSubmit={onSubmit}>
              <Stack>
                {isRegisterMode ? (
                  <>
                    <TextInput
                      label="Ник"
                      description="Используется для входа в аккаунт"
                      leftSection={<IconUser size={15} />}
                      value={nickname}
                      onChange={(e) => setNickname(e.currentTarget.value)}
                      styles={fieldStyles}
                      required
                    />
                    <TextInput
                      label="Имя для комнаты"
                      description="Это имя будет видно другим участникам комнаты"
                      leftSection={<IconUser size={15} />}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.currentTarget.value)}
                      styles={fieldStyles}
                      required
                    />
                  </>
                ) : (
                  <TextInput
                    label="Ник"
                    leftSection={<IconUser size={15} />}
                    value={nickname}
                    onChange={(e) => setNickname(e.currentTarget.value)}
                    styles={fieldStyles}
                    required
                  />
                )}
                <PasswordInput
                  label="Пароль"
                  description={isRegisterMode ? "Минимум 6 символов" : undefined}
                  leftSection={<IconKey size={15} />}
                  value={password}
                  onChange={(e) => {
                    const nextPassword = e.currentTarget.value;
                    setPassword(nextPassword);
                    if (!isRegisterMode) return;
                    if (nextPassword.length >= 6) {
                      setPasswordError("");
                    }
                  }}
                  error={passwordError || undefined}
                  styles={fieldStyles}
                  required
                />
                <Button
                  type="submit"
                  loading={isLoading}
                  fullWidth
                  h={42}
                  style={{ background: "#f3f5f7", color: "#0f1115" }}
                >
                  {mode === "login" ? "Войти в кабинет" : "Создать аккаунт"}
                </Button>
              </Stack>
            </form>

            <Text
              c={error ? "red.4" : "transparent"}
              size="sm"
              aria-live="polite"
              style={{ minHeight: 44, overflowWrap: "anywhere" }}
            >
              {feedbackText}
            </Text>

            <Group justify="center">
              <Anchor component={Link} to="/" c="#c9d0db">
                На главную страницу
              </Anchor>
            </Group>
          </Stack>
        </Card>
      </Container>
    </Box>
  );
}

function extractApiErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const maybeError = error as {
    data?: unknown;
    error?: string;
  };
  if (typeof maybeError.error === "string" && maybeError.error.trim()) {
    return maybeError.error;
  }
  if (!maybeError.data || typeof maybeError.data !== "object") return null;
  const data = maybeError.data as { error?: unknown };
  if (typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }
  return null;
}
