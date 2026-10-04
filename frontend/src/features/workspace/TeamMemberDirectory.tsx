import React, { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Group, Pagination, Stack, Text } from "components/antd-compat";
import { useGetTeamMembersQuery } from "../../services/api";
import type { TeamMemberDirectoryItem } from "../../types";
import styles from "./TeamMemberDirectory.module.css";

type Props = {
  readonly accountId: string;
  readonly teamId: string;
  readonly renderActions?: (member: TeamMemberDirectoryItem, fetching: boolean) => React.ReactNode;
  readonly onMembersChange?: (members: readonly TeamMemberDirectoryItem[]) => void;
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

export function TeamMemberDirectory({ accountId, teamId, renderActions, onMembersChange }: Props) {
  const [page, setPage] = useState(0);
  const query = useMemo(() => ({
    accountId,
    teamId,
    page,
    size: PAGE_SIZE,
  }), [accountId, page, teamId]);
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

  useEffect(() => {
    if (data && !isError) onMembersChange?.(data.items);
  }, [data, isError, onMembersChange]);

  useEffect(() => {
    if (data && page > 0 && page >= data.totalPages) setPage(Math.max(0, data.totalPages - 1));
  }, [data, page]);

  const hasRows = Boolean(data && data.items.length > 0);
  const showLoading = isLoading || (isFetching && !data);
  const pageCount = data?.totalPages ?? 0;
  const invalidQuery = isError && isInvalidListQuery(error);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" gap="md" wrap="wrap">
        <Stack gap="xs">
          <Text fw={700} size="lg">Состав команды</Text>
          <Text c="gray.5" size="sm">Видны только активные участники этой команды.</Text>
        </Stack>
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
                ? "Не удалось открыть эту страницу состава. Обновите данные и повторите попытку."
                : "Повторите попытку. Данные участников пока не показаны."}
            </Text>
            <Button className={styles.retry} variant="light" onClick={() => void refetch()}>Повторить</Button>
          </Stack>
        </Alert>
      ) : null}

      {!isError && !showLoading && !hasRows ? (
        <Card className={styles.empty} withBorder>
          <Stack gap="xs">
            <Text fw={700}>Участники не найдены</Text>
          </Stack>
        </Card>
      ) : null}

      {!isError && data && data.items.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-label="Состав команды">
            <thead><tr><th scope="col">Участник</th><th scope="col">Роль</th><th scope="col">Процессы</th>{renderActions ? <th scope="col">Действия</th> : null}</tr></thead>
            <tbody>
              {data.items.map((member) => (
                <tr key={member.userId}>
                  <th scope="row">
                    <Group gap="xs" align="center">
                      <Text fw={700}>{member.displayName}</Text>
                      {member.userId === accountId ? <Badge color="teal" variant="light">Вы</Badge> : null}
                    </Group>
                  </th>
                  <td><Badge color={member.role === "OWNER" ? "teal" : "blue"} variant="light">{memberRoleLabel(member.role)}</Badge></td>
                  <td>
                    {member.processes?.length ? (
                      <Group gap="xs" aria-label={`Процессы участника ${member.displayName}`}>
                        {member.processes.map((process) => (
                          <Badge key={`${process.trackId}:${process.vacancyId ?? ""}`} color="gray" variant="light">
                            {process.vacancyTitle ? `${process.trackName} · ${process.vacancyTitle}` : process.trackName}
                          </Badge>
                        ))}
                      </Group>
                    ) : <Text size="sm" c="gray.5">—</Text>}
                  </td>
                  {renderActions ? <td>{renderActions(member, isFetching)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
