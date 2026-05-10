import React, { FormEvent, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Container,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title
} from "@mantine/core";
import { IconArrowRight, IconCode, IconDeviceLaptop, IconUsers } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router-dom";
import { useAppSelector } from "../app/hooks";
import { useCreateGuestRoomMutation } from "../services/api";
import { setVisitParams, trackEvent } from "../services/analytics";

const LANGUAGES = [
  { value: "nodejs", label: "Node JS" },
  { value: "python", label: "Python" },
  { value: "kotlin", label: "Kotlin" },
  { value: "java", label: "Java" },
  { value: "sql", label: "SQL" }
];

const darkFieldStyles = {
  label: { color: "#9ba0a8", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    backgroundColor: "#14171d",
    borderColor: "#272b34",
    color: "#f3f5f7"
  },
  dropdown: {
    backgroundColor: "#14171d",
    borderColor: "#272b34"
  },
  option: {
    color: "#f3f5f7"
  }
};

export function LandingPage() {
  const navigate = useNavigate();
  const authToken = useAppSelector((store) => store.auth.token);
  const [title, setTitle] = useState("Live-coding interview");
  const [displayName, setDisplayName] = useState("Interviewer");
  const [language, setLanguage] = useState("nodejs");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [createGuestRoom, { isLoading }] = useCreateGuestRoomMutation();

  useEffect(() => {
    trackEvent("mkt_landing_view", {
      authenticated: Boolean(authToken)
    });
    setVisitParams({
      entrypoint: "landing",
      authenticated: Boolean(authToken)
    });
  }, [authToken]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    trackEvent("prod_guest_room_create_submit", {
      language,
      has_title: title.trim().length > 0,
      has_display_name: displayName.trim().length > 0
    });
    try {
      setError("");
      const room = await createGuestRoom({
        title,
        ownerDisplayName: displayName,
        language
      }).unwrap();
      // Persist the owner session token only for true anonymous rooms.
      // When the visitor is already authenticated the backend binds the
      // room to their account (`ownerUser`) and doesn't return a session
      // token — it isn't needed because we authorize via Bearer.
      if (room.ownerToken) {
        localStorage.setItem(`owner_token_${room.inviteCode}`, room.ownerToken);
      }
      // Guest display name is only relevant for anonymous owners. For
      // authenticated users we read the name from their profile in
      // `RoomPage`, so storing a fallback here just litters localStorage.
      if (!authToken) {
        localStorage.setItem(`guest_display_name_${room.inviteCode}`, displayName);
      }
      trackEvent("prod_guest_room_create_success", {
        language,
        room_invite_len: room.inviteCode.length
      });
      navigate(`/room/${room.inviteCode}`);
    } catch {
      setError("Не удалось создать комнату. Повторите попытку.");
      trackEvent("prod_guest_room_create_failed", {
        language
      });
    }
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    const name = (displayName || "Участник").trim();
    const code = inviteCode.trim();
    trackEvent("prod_room_join_submit", {
      invite_code_len: code.length,
      has_display_name: name.length > 0
    });
    localStorage.setItem(`guest_display_name_${code}`, name);
    navigate(`/room/${code}`);
  };

  return (
    <Box style={{ minHeight: "100vh", background: "#0f1115", color: "#f3f5f7" }}>
      <Box style={{ borderBottom: "1px solid #262a31", background: "#101318" }}>
        <Container size="xl" py={10}>
          <Group justify="space-between">
            <Group gap="sm">
              <ThemeIcon size={30} radius={8} variant="light" color="gray">
                <IconCode size={16} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={4} fw={700} c="#f3f5f7">
                  Interview Online
                </Title>
                <Text size="xs" c="#8b919b">
                  realtime coding room
                </Text>
              </Stack>
            </Group>
            <Group>
              <Badge variant="outline" color="gray">
                Minimal mode
              </Badge>
              <Button
                component={Link}
                to={authToken ? "/dashboard/rooms" : "/login"}
                size="xs"
                variant="light"
                color="gray"
              >
                Личный кабинет
              </Button>
            </Group>
          </Group>
        </Container>
      </Box>

      <Container size="xl" py={24}>
        <Group align="stretch" gap="md" wrap="nowrap" style={{ flexWrap: "wrap" }}>
          <Card
            withBorder
            radius="lg"
            p="xl"
            style={{
              flex: 1.1,
              minWidth: 320,
              background: "linear-gradient(180deg, #141821 0%, #101318 100%)",
              borderColor: "#272b34"
            }}
          >
            <Stack gap="lg">
              <Stack gap={6}>
                <Text size="xs" c="#8b919b" tt="uppercase" fw={700} lts={1.2}>
                  Live Coding Session
                </Text>
                <Title order={1} fw={800} c="#f3f5f7" style={{ maxWidth: 520 }}>
                  Запускайте интервью за 30 секунд.
                </Title>
                <Text c="#a6acb7" maw={560}>
                  Общий редактор, шаги интервью, owner-only run и стабильная синхронизация участников без визуального шума.
                </Text>
              </Stack>

              <Group grow>
                <Card withBorder p="md" bg="#12161c" style={{ borderColor: "#242931" }}>
                  <Group>
                    <ThemeIcon color="gray" variant="light" size={26}>
                      <IconUsers size={14} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={700} size="sm" c="#eff2f6">
                        Interviewer + Candidate
                      </Text>
                      <Text size="xs" c="#8b919b">
                        Список участников и контроль ролей
                      </Text>
                    </Stack>
                  </Group>
                </Card>
                <Card withBorder p="md" bg="#12161c" style={{ borderColor: "#242931" }}>
                  <Group>
                    <ThemeIcon color="gray" variant="light" size={26}>
                      <IconDeviceLaptop size={14} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={700} size="sm" c="#eff2f6">
                        Step-by-step flow
                      </Text>
                      <Text size="xs" c="#8b919b">
                        Управление задачами по шагам
                      </Text>
                    </Stack>
                  </Group>
                </Card>
              </Group>

              <Card withBorder p="md" bg="#0f1218" style={{ borderColor: "#242931" }}>
                <Text component="pre" c="#c9d0db" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
{`# Python

def solve(nums):
    return sum(nums)

# Node JS
function solve(nums) {
  return nums.reduce((a, b) => a + b, 0);
}`}
                </Text>
              </Card>
            </Stack>
          </Card>

          <Stack style={{ flex: 0.9, minWidth: 320 }} gap="md">
            <Card
              withBorder
              radius="lg"
              p="xl"
              style={{ background: "#11151c", borderColor: "#272b34" }}
            >
              <form onSubmit={onCreate}>
                <Stack>
                  <Title order={2} c="#f3f5f7" size="h3">
                    Создать комнату
                  </Title>
                  <Text size="sm" c="#8b919b">
                    Быстрый вход для интервьюера без регистрации.
                  </Text>
                  <TextInput
                    label="Ваш ник"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.currentTarget.value)}
                    styles={darkFieldStyles}
                    required
                  />
                  <TextInput
                    label="Название комнаты"
                    value={title}
                    onChange={(e) => setTitle(e.currentTarget.value)}
                    styles={darkFieldStyles}
                    required
                  />
                  <Select
                    label="Язык"
                    data={LANGUAGES}
                    value={language}
                    onChange={(value) => setLanguage(value ?? "nodejs")}
                    styles={darkFieldStyles}
                    required
                  />
                  <Button
                    type="submit"
                    loading={isLoading}
                    rightSection={<IconArrowRight size={15} />}
                    style={{ background: "#f3f5f7", color: "#0f1115" }}
                  >
                    Создать комнату
                  </Button>
                </Stack>
              </form>
            </Card>

            <Card withBorder radius="lg" p="xl" style={{ background: "#11151c", borderColor: "#272b34" }}>
              <form onSubmit={onJoin}>
                <Stack>
                  <Title order={2} c="#f3f5f7" size="h3">
                    Войти по коду
                  </Title>
                  <TextInput
                    label="Ваш ник"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.currentTarget.value)}
                    styles={darkFieldStyles}
                    required
                  />
                  <TextInput
                    label="Код комнаты"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.currentTarget.value)}
                    placeholder="r-xxxxxxxx"
                    styles={darkFieldStyles}
                    required
                  />
                  <Button variant="outline" color="gray" type="submit">
                    Подключиться
                  </Button>
                </Stack>
              </form>
            </Card>

            {error && <Text c="red.4">{error}</Text>}
          </Stack>
        </Group>
      </Container>
    </Box>
  );
}
