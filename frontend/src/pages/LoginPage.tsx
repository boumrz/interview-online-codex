import React, { FormEvent, useState } from "react";
import {
  Anchor,
  Badge,
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
import { Link, Navigate, useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const authToken = useAppSelector((store) => store.auth.token);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [login, loginState] = useLoginMutation();
  const [register, registerState] = useRegisterMutation();
  const isLoading = loginState.isLoading || registerState.isLoading;

  if (authToken) {
    return <Navigate to="/dashboard/rooms" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      const fn = mode === "login" ? login : register;
      const auth = await fn({ nickname, password }).unwrap();
      dispatch(setAuth(auth));
      navigate("/dashboard/rooms");
    } catch {
      setError("Не удалось выполнить вход. Проверьте ник и пароль.");
    }
  };

  return (
    <Box style={{ minHeight: "100vh", background: "#0f1115", display: "flex", alignItems: "center" }}>
      <Container size="xs" py={40}>
        <Card withBorder radius="lg" padding="xl" bg="#11151c" c="gray.1" style={{ borderColor: "#272b34" }}>
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
              <Badge variant="outline" color="gray">
                nickname auth
              </Badge>
            </Group>

            <Text c="#8b919b" size="sm">
              Вход и регистрация только по никнейму и паролю.
            </Text>

            <SegmentedControl
              value={mode}
              onChange={(value) => setMode(value as "login" | "register")}
              data={[
                { label: "Вход", value: "login" },
                { label: "Регистрация", value: "register" }
              ]}
            />

            <form onSubmit={onSubmit}>
              <Stack>
                <TextInput
                  label="Ник"
                  leftSection={<IconUser size={15} />}
                  value={nickname}
                  onChange={(e) => setNickname(e.currentTarget.value)}
                  styles={fieldStyles}
                  required
                />
                <PasswordInput
                  label="Пароль"
                  leftSection={<IconKey size={15} />}
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  styles={fieldStyles}
                  required
                />
                <Button type="submit" loading={isLoading} style={{ background: "#f3f5f7", color: "#0f1115" }}>
                  {mode === "login" ? "Войти в кабинет" : "Создать аккаунт"}
                </Button>
              </Stack>
            </form>

            {error && <Text c="red.4">{error}</Text>}

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
