import React, { useMemo } from "react";
import { Alert, Button, Group, Select, Stack } from "components/antd-compat";
import { useGetTeamTracksQuery } from "../../services/api";
import type { TeamTrack } from "../../types";
import styles from "./TeamProcessFilters.module.css";

export type TeamProcessFilterValue = { trackId: string; vacancyId: string };

type Props = {
  accountId: string;
  teamId: string;
  value: TeamProcessFilterValue;
  onChange: (value: TeamProcessFilterValue) => void;
};

export function TeamProcessFilters({ accountId, teamId, value, onChange }: Props) {
  const scope = { accountId, teamId, kind: "TEAM" as const, query: "process-filters" };
  const active = useGetTeamTracksQuery({ ...scope, status: "active" }, { skip: !accountId });
  const archived = useGetTeamTracksQuery({ ...scope, status: "archived" }, { skip: !accountId });
  const tracks = useMemo(() => {
    const byId = new Map<string, TeamTrack>();
    for (const track of [...(active.currentData?.items ?? []), ...(archived.currentData?.items ?? [])]) {
      const existing = byId.get(track.id);
      const vacancies = new Map([...(existing?.vacancies ?? []), ...track.vacancies].map(vacancy => [vacancy.id, vacancy]));
      byId.set(track.id, { ...track, vacancies: [...vacancies.values()] });
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [active.currentData, archived.currentData]);
  const selectedTrack = tracks.find(track => track.id === value.trackId);
  const vacancies = (selectedTrack ? [selectedTrack] : tracks).flatMap(track => track.vacancies.map(vacancy => ({ ...vacancy, trackName: track.name })));
  const loading = active.isLoading || archived.isLoading;

  return <Stack gap="xs">
    <Group className={styles.filters} align="flex-end" gap="md" wrap="wrap">
      <Select
        className={styles.select}
        label="Трек"
        aria-label="Фильтр по треку"
        value={value.trackId}
        data={[{ value: "", label: "Все треки" }, ...tracks.map(track => ({ value: track.id, label: `${track.name}${track.status === "ARCHIVED" ? " (в архиве)" : ""}` }))]}
        searchable
        disabled={loading && tracks.length === 0}
        onChange={trackId => onChange({ trackId: trackId ?? "", vacancyId: "" })}
      />
      <Select
        className={styles.select}
        label="Вакансия"
        aria-label="Фильтр по вакансии"
        value={value.vacancyId}
        data={[{ value: "", label: "Все вакансии" }, ...vacancies.map(vacancy => ({ value: vacancy.id, label: `${vacancy.title}${vacancy.status === "ARCHIVED" ? " (в архиве)" : ""}${selectedTrack ? "" : ` · ${vacancy.trackName}`}` }))]}
        searchable
        disabled={loading && tracks.length === 0}
        onChange={vacancyId => onChange({ ...value, vacancyId: vacancyId ?? "" })}
      />
    </Group>
    {active.isError || archived.isError ? <Alert color="orange" role="alert" title="Не удалось загрузить все треки и вакансии">
      <Button type="button" variant="light" size="xs" onClick={() => { void active.refetch(); void archived.refetch(); }}>Повторить загрузку фильтров</Button>
    </Alert> : null}
  </Stack>;
}
