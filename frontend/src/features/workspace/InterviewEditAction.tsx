import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { App } from "antd";
import { Alert, Button, Group, Loader, Modal, MultiSelect, Select, Text, TextInput } from "components/antd-compat";
import { IconPencil } from "components/antd-icons";
import { useAppSelector } from "../../app/hooks";
import { useAddHrManagerMutation, useLazyGetHrManagersQuery, useLazyGetTeamInterviewDetailsQuery, useLazyGetTeamMembersQuery, useLazyGetTeamTracksQuery, useLazyGetPersonalInterviewDetailsQuery, useRemoveHrManagerMutation, useUpdateTeamInterviewDetailsMutation, useUpdatePersonalInterviewDetailsMutation } from "../../services/api";
import { getApiErrorMessage } from "../../services/apiErrors";
import type { HrManager, InterviewMetadata, TeamInterviewDetails, TeamMemberDirectoryItem, TeamTrack } from "../../types";
import { HiringManagerPicker } from "../hr/HiringManagerPicker";
import { instantToMoscowInput, moscowInputToInstant } from "../hr/hrDate";

type Props = {
  accountId: string;
  interview: { id: string; inviteCode: string; title: string };
  canEditTitle?: boolean;
  ownerToken?: string;
  interviewerToken?: string;
} & ({ kind: "TEAM"; teamId: string } | { kind: "PERSONAL"; teamId?: never });
type Details = InterviewMetadata & { title: string } & Partial<Pick<TeamInterviewDetails, "trackId" | "trackName" | "vacancyId" | "vacancyTitle" | "ownerUserId" | "interviewerIds">>;
type Abortable = { abort: () => void };

export function InterviewEditAction(props: Props) {
  const token = useAppSelector(state => state.auth.token);
  return <InterviewEditSession key={`${props.accountId}:${token}:${props.kind}:${props.teamId ?? ""}:${props.interview.id}`} {...props} token={token} />;
}

function InterviewEditSession({ accountId, teamId, kind, interview, canEditTitle = true, ownerToken, interviewerToken, token }: Props & { token: string | null }) {
  const { notification } = App.useApp();
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Details | null>(null);
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [trackId, setTrackId] = useState("");
  const [vacancyId, setVacancyId] = useState("");
  const [tracks, setTracks] = useState<readonly TeamTrack[]>([]);
  const [members, setMembers] = useState<readonly TeamMemberDirectoryItem[]>([]);
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [managers, setManagers] = useState<HrManager[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [hrError, setHrError] = useState("");
  const [pickerPending, setPickerPending] = useState(false);
  const [getDetails] = useLazyGetTeamInterviewDetailsQuery();
  const [getPersonalDetails] = useLazyGetPersonalInterviewDetailsQuery();
  const [getManagers] = useLazyGetHrManagersQuery();
  const [getTracks] = useLazyGetTeamTracksQuery();
  const [getMembers] = useLazyGetTeamMembersQuery();
  const [updateDetails, teamSaveState] = useUpdateTeamInterviewDetailsMutation();
  const [updatePersonalDetails, personalSaveState] = useUpdatePersonalInterviewDetailsMutation();
  const saveState = kind === "TEAM" ? teamSaveState : personalSaveState;
  const [addManager, addState] = useAddHrManagerMutation();
  const [removeManager, removeState] = useRemoveHrManagerMutation();
  const generation = useRef(0);
  const active = useRef(true);
  const requests = useRef(new Set<Abortable>());
  const pending = saveState.isLoading || addState.isLoading || removeState.isLoading || pickerPending;
  const scope = { accountId, kind: "TEAM" as const, teamId: teamId ?? "", query: "interview-details", interviewId: interview.id };
  const credentials = { inviteCode: interview.inviteCode, ownerToken, interviewerToken };
  const invalidate = () => { generation.current += 1; requests.current.forEach(request => request.abort()); requests.current.clear(); };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; invalidate(); };
  }, []);
  const current = (captured: number) => active.current && generation.current === captured && localStorage.getItem("auth_token") === token;
  const track = <T extends Abortable>(request: T): T => { requests.current.add(request); return request; };
  const apply = (details: Details) => {
    setSnapshot(details); setTitle(details.title); setCandidateName(details.candidateName ?? "");
    setPosition(details.position ?? ""); setScheduledAt(instantToMoscowInput(details.scheduledAt)); setConflict(false);
    setTrackId(details.trackId ?? ""); setVacancyId(details.vacancyId ?? "");
    setInterviewerIds([...(details.interviewerIds ?? [])]);
  };
  const clear = () => { setSnapshot(null); setTitle(""); setCandidateName(""); setPosition(""); setScheduledAt(""); setTrackId(""); setVacancyId(""); setTracks([]); setMembers([]); setInterviewerIds([]); setManagers([]); setError(""); setHrError(""); setConflict(false); setUnavailable(false); };
  const handleError = (caught: unknown, fallback: string) => {
    const status = caught && typeof caught === "object" && "status" in caught ? caught.status : null;
    const data = caught && typeof caught === "object" && "data" in caught ? caught.data : null;
    const code = data && typeof data === "object" && "code" in data ? data.code : null;
    if (kind === "TEAM" && status === 404 && code === "TEAM_MEMBER_NOT_FOUND") {
      setError("Выбранный интервьюер недоступен. Измените состав участников и повторите сохранение.");
    } else if (status === 401 || status === 403 || status === 404) {
      clear(); setUnavailable(true); setError("Доступ к интервью изменился. Закройте окно и обновите список.");
    } else if (status === 410) {
      setUnavailable(true); setError("Интервью в архиве. Изменения недоступны.");
    } else {
      setError(status === 409 ? "Интервью изменил другой участник. Ваш черновик сохранён в форме." : getApiErrorMessage(caught, fallback));
      if (status === 409) setConflict(true);
    }
  };
  const load = async () => {
    invalidate(); const captured = generation.current;
    setLoading(true); setError("");
    try {
      const loadMembers = async () => {
        if (kind !== "TEAM") return [];
        const items: TeamMemberDirectoryItem[] = [];
        let page = 0;
        let totalPages = 1;
        while (page < totalPages && current(captured)) {
          const response = await track(getMembers({ accountId, teamId: teamId!, page, size: 100, state: "ACTIVE" }, false)).unwrap();
          items.push(...response.items); totalPages = response.totalPages; page += 1;
        }
        return items;
      };
      const [details, nextManagers, trackData, nextMembers] = await Promise.all([
        track(kind === "TEAM"
          ? getDetails({ ...scope, requestGeneration: captured }, false)
          : getPersonalDetails({ roomId: interview.id, requestGeneration: captured }, false)).unwrap(),
        track(getManagers({ ...credentials, requestGeneration: captured }, false)).unwrap(),
        kind === "TEAM" ? track(getTracks({ ...scope, query: `interview-edit-tracks:${captured}`, status: "active" }, false)).unwrap() : Promise.resolve(null),
        loadMembers(),
      ]);
      if (!current(captured)) return;
      apply(details); setManagers(nextManagers); setTracks(trackData?.items ?? []); setMembers(nextMembers); setUnavailable(false);
    } catch (caught) {
      if (current(captured)) handleError(caught, "Не удалось загрузить интервью. Повторите попытку.");
    } finally { if (current(captured)) setLoading(false); }
  };
  const close = () => {
    if (pending) return;
    invalidate(); setOpened(false); setLoading(false); clear();
  };
  const instant = scheduledAt ? moscowInputToInstant(scheduledAt) : null;
  const changed = snapshot && ((canEditTitle && title.trim() !== snapshot.title) || (candidateName.trim() || null) !== snapshot.candidateName || (position.trim() || null) !== snapshot.position || (scheduledAt && !instant) || (instant ? Date.parse(instant) : null) !== (snapshot.scheduledAt ? Date.parse(snapshot.scheduledAt) : null) || (kind === "TEAM" && ((trackId || null) !== (snapshot.trackId ?? null) || (vacancyId || null) !== (snapshot.vacancyId ?? null))));
  const participantsChanged = kind === "TEAM" && snapshot && JSON.stringify([...interviewerIds].sort()) !== JSON.stringify([...(snapshot.interviewerIds ?? [])].sort());
  const otherMembers = members.filter(member => member.userId !== snapshot?.ownerUserId && !managers.some(manager => manager.userId === member.userId));
  const interviewerOptions = [
    ...otherMembers.map(member => ({ value: member.userId, label: member.displayName })),
    ...interviewerIds.filter(id => !otherMembers.some(member => member.userId === id)).map(id => ({ value: id, label: "Участник недоступен" })),
  ];
  const selectedTrack = tracks.find(item => item.id === trackId);
  const trackOptions = [{ value: "", label: "Без трека" }, ...tracks.map(item => ({ value: item.id, label: item.name }))];
  if (snapshot?.trackId && !tracks.some(item => item.id === snapshot.trackId)) trackOptions.push({ value: snapshot.trackId, label: `${snapshot.trackName || "Трек"} (архив)` });
  const vacancyOptions = [{ value: "", label: "Без вакансии" }, ...(selectedTrack?.vacancies.filter(item => item.status === "ACTIVE").map(item => ({ value: item.id, label: item.title })) ?? [])];
  if (snapshot?.vacancyId && trackId === snapshot.trackId && !vacancyOptions.some(item => item.value === snapshot.vacancyId)) vacancyOptions.push({ value: snapshot.vacancyId, label: `${snapshot.vacancyTitle || "Вакансия"} (архив)` });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!snapshot || pending || unavailable) return;
    if (!title.trim()) { setError("Введите название интервью"); return; }
    if (scheduledAt && !instant) { setError("Проверьте дату и время интервью"); return; }
    invalidate(); const captured = generation.current; setError(""); setConflict(false);
    try {
      const draft = {
        title: canEditTitle ? title.trim() : snapshot.title,
        candidateName: candidateName.trim() || null, position: position.trim() || null,
        scheduledAt: instant, revision: snapshot.revision,
        ...(kind === "TEAM" ? { context: { trackId: trackId || null, vacancyId: vacancyId || null }, interviewerIds } : {}),
      };
      const details = await track(kind === "TEAM"
        ? updateDetails({ ...scope, details: draft })
        : updatePersonalDetails({ roomId: interview.id, details: draft })).unwrap();
      if (!current(captured)) return;
      apply(details); notification.success({ title: "Интервью сохранено", placement: "top", role: "status" });
    } catch (caught) {
      if (current(captured)) handleError(caught, "Не удалось сохранить интервью. Повторите попытку.");
    }
  };
  const add = async (userId: string) => {
    if (saveState.isLoading || addState.isLoading || removeState.isLoading || unavailable || !snapshot) return false;
    const captured = generation.current; setHrError("");
    try {
      const next = await track(addManager({ ...credentials, userId })).unwrap();
      if (!current(captured)) return false;
      setManagers(next); notification.success({ title: "Нанимающий добавлен", placement: "top", role: "status" }); return true;
    } catch (caught) {
      if (current(captured)) { setHrError(getApiErrorMessage(caught, "Не удалось добавить нанимающего. Повторите попытку.")); handleAccessError(caught); }
      return false;
    }
  };
  const handleAccessError = (caught: unknown) => {
    const status = caught && typeof caught === "object" && "status" in caught ? caught.status : null;
    if (status === 401 || status === 403 || status === 410) handleError(caught, "Доступ к интервью изменился.");
  };
  const remove = async (manager: HrManager) => {
    if (pending || unavailable || manager.isOwner) return;
    const captured = generation.current; setHrError("");
    try {
      await track(removeManager({ ...credentials, userId: manager.userId })).unwrap();
      if (!current(captured)) return;
      setManagers(previous => previous.filter(item => item.userId !== manager.userId));
      notification.success({ title: "Роль нанимающего снята", placement: "top", role: "status" });
      if (manager.userId === accountId) {
        clear();
        await load();
      }
    } catch (caught) {
      if (current(captured)) { setHrError(getApiErrorMessage(caught, "Не удалось снять роль нанимающего. Повторите попытку.")); handleAccessError(caught); }
    }
  };
  return <>
    <Button type="button" variant="light" size="compact-sm" leftSection={<IconPencil size={16} />} aria-label={`Редактировать интервью ${interview.title}`} onClick={() => { clear(); setOpened(true); void load(); }}>Редактировать</Button>
    <Modal opened={opened} authoring title="Редактировать интервью" centered size="lg" onClose={close} closeOnEscape={!pending} closeOnClickOutside={!pending} withCloseButton={!pending}>
      <form className="app-authoring-form" onSubmit={save}>
        <div className="app-authoring-fields">
          {loading ? <Group aria-busy="true"><Loader size="sm" /><Text>Загружаем интервью…</Text></Group> : null}
          {error ? <Alert color={conflict ? "yellow" : "red"} role="alert">{error}{!unavailable && (conflict || !snapshot) ? <Button type="button" variant="light" disabled={loading || pending} onClick={() => void load()}>{conflict ? "Загрузить актуальные сведения" : "Повторить"}</Button> : null}</Alert> : null}
          {snapshot && !loading ? <>
            <section className="app-authoring-section" aria-label="Основное">
              <h4>Основное</h4>
              <TextInput autoFocus label="Название интервью" placeholder="Введите название интервью" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.currentTarget.value)} disabled={pending || unavailable || !canEditTitle} />
              <TextInput label="Имя кандидата" placeholder="Введите имя кандидата" value={candidateName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCandidateName(event.currentTarget.value)} maxLength={200} disabled={pending || unavailable} />
              <TextInput label="Позиция" placeholder="Введите название должности" value={position} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPosition(event.currentTarget.value)} maxLength={200} disabled={pending || unavailable} />
              <TextInput type="datetime-local" label="Дата и время интервью (МСК)" value={scheduledAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setScheduledAt(event.currentTarget.value)} disabled={pending || unavailable} />
              {kind === "TEAM" ? <div className="app-authoring-grid">
                <Select label="Трек интервью" aria-label="Трек интервью" searchable value={trackId} data={trackOptions} onChange={value => { setTrackId(value ?? ""); setVacancyId(""); }} disabled={pending || unavailable} />
                <Select label="Вакансия" aria-label="Вакансия" searchable value={vacancyId} data={vacancyOptions} onChange={value => setVacancyId(value ?? "")} disabled={pending || unavailable || !trackId} />
              </div> : null}
            </section>
            <section className="app-authoring-section" aria-label={kind === "TEAM" ? "Участники" : "Нанимающие"}>
              {kind === "TEAM" ? <>
                <h4>Участники</h4>
                <MultiSelect label="Другие интервьюеры (необязательно)" aria-label="Другие интервьюеры (необязательно)"
                  placeholder={otherMembers.length ? "Выберите участников команды" : "Других участников пока нет"}
                  value={interviewerIds} data={interviewerOptions}
                  searchable clearable maxTagCount={2} onChange={setInterviewerIds} disabled={pending || unavailable} />
              </> : null}
              {hrError ? <Alert color="red" role="alert">{hrError}</Alert> : null}
              {managers.map(manager => <Group key={manager.userId} justify="space-between" wrap="wrap"><Text>{manager.displayName}</Text>{!manager.isOwner ? <Button type="button" size="sm" variant="light" color="red" aria-label={`Снять роль нанимающего у ${manager.displayName}`} disabled={pending || unavailable} onClick={() => void remove(manager)}>Снять роль нанимающего</Button> : null}</Group>)}
              <HiringManagerPicker label={kind === "TEAM" ? "Внешний нанимающий (необязательно)" : "Нанимающий"} {...(kind === "TEAM" ? { teamId } : { room: credentials })} selectedIds={managers.map(manager => manager.userId)} disabled={saveState.isLoading || addState.isLoading || removeState.isLoading || unavailable} onPendingChange={setPickerPending} showSuccess={false} onSelect={person => add(person.normalizedId)} />
            </section>
          </> : null}
        </div>
        <div className="app-form-actions">
          <Button type="button" variant="subtle" disabled={pending} onClick={close}>Отмена</Button>
          <Button type="submit" loading={saveState.isLoading} disabled={pending || loading || unavailable || !snapshot || !title.trim() || (!changed && !participantsChanged)}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  </>;
}
