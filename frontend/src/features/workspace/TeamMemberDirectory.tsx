import React, { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Pagination, Stack, Text, TextInput } from "@mantine/core";
import { useGetTeamMembersQuery } from "../../services/api";
import type { TeamMemberDirectoryItem } from "../../types";
import styles from "./TeamMemberDirectory.module.css";

type Props = {
  readonly accountId: string;
  readonly teamId: string;
};

const PAGE_SIZE = 25;

function memberRoleLabel(role: TeamMemberDirectoryItem["role"]): string {
  switch (role) {
    case "OWNER":
      return "Владелец";
    case "ADMIN":
      return "Администратор";
    case "MEMBER":
      return "Участник";
  }
}

function isInvalidListQuery(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 400);
}

export function TeamMemberDirectory({ accountId, teamId }: Props) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const normalizedSearch = search.trim();
  const query = useMemo(() => ({
    accountId,
    teamId,
    page,
    size: PAGE_SIZE,
    ...(normalizedSearch ? { q: normalizedSearch } : {}),
  }), [accountId, normalizedSearch, page, teamId]);
  const {
    data,
    error,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useGetTeamMembersQuery(query, { refetchOnMountOrArgChange: true });

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refetch]);

  const hasRows = Boolean(data && data.items.length > 0);
  const showLoading = isLoading || (isFetching && !data);
  const pageCount = data?.totalPages ?? 0;
  const invalidQuery = isError && isInvalidListQuery(error);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <div>
          <Text fw={700} size="lg">Состав команды</Text>
          <Text c="gray.5" size="sm">Видны только активные участники этой команды.</Text>
        </div>
        <TextInput
          className={styles.search}
          label="Поиск участников"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(0);
          }}
        />
      </Group>

      {showLoading ? (
        <Stack role="status" aria-label="Загружаем участников" gap="xs">
          <Text c="gray.5">Загружаем участников…</Text>
        </Stack>
      ) : null}

      {isError ? (
        <Alert color="red" role="alert" aria-label="Не удалось загрузить участников" title="Не удалось загрузить участников">
          <Stack gap="sm">
            <Text size="sm">
              {invalidQuery
                ? "Проверьте поисковый запрос: он не должен быть длиннее 200 символов."
                : "Повторите попытку. Данные участников пока не показаны."}
            </Text>
            <Button className={styles.retry} variant="light" onClick={() => void refetch()}>Повторить</Button>
          </Stack>
        </Alert>
      ) : null}

      {!isError && !showLoading && !hasRows ? (
        <Card className={styles.empty} withBorder>
          <Text fw={700}>Участники не найдены</Text>
          {normalizedSearch ? <Text size="sm" c="gray.5">Измените запрос и попробуйте снова.</Text> : null}
        </Card>
      ) : null}

      {!isError && data && data.items.length > 0 ? (
        <Stack gap="sm">
          {data.items.map((member) => (
            <Card key={member.userId} className={styles.member} withBorder>
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Group gap="xs">
                    <Text fw={700}>{member.displayName}</Text>
                    {member.userId === accountId ? <Badge color="teal" variant="light">Вы</Badge> : null}
                  </Group>
                  <Text size="sm" c="gray.5">Активный участник</Text>
                  {member.processes?.length ? (
                    <Group gap="xs" mt="xs" aria-label={`Процессы участника ${member.displayName}`}>
                      {member.processes.map((process) => (
                        <Badge key={`${process.trackId}:${process.vacancyId ?? ""}`} color="gray" variant="light">
                          {process.vacancyTitle ? `${process.trackName} · ${process.vacancyTitle}` : process.trackName}
                        </Badge>
                      ))}
                    </Group>
                  ) : null}
                </div>
                <Badge color={member.role === "OWNER" ? "teal" : "blue"} variant="light">
                  {memberRoleLabel(member.role)}
                </Badge>
              </Group>
            </Card>
          ))}
        </Stack>
      ) : null}

      {!isError && data ? (
        <Group component="nav" aria-label="Пагинация участников" justify="space-between">
          <Text size="sm" c="gray.5">
            {data.totalElements === 0 ? "0 участников" : `Страница ${data.page + 1} из ${Math.max(1, data.totalPages)}`}
          </Text>
          {pageCount > 1 ? (
            <Pagination
              total={pageCount}
              value={page + 1}
              onChange={(nextPage) => setPage(nextPage - 1)}
              disabled={isFetching}
              withEdges
              siblings={1}
              boundaries={1}
              aria-label="Страницы участников"
            />
          ) : null}
        </Group>
      ) : null}
    </Stack>
  );
}
