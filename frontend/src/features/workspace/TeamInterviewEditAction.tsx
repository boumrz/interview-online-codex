import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { App } from "antd";
import { Alert, Button, Group, Loader, Modal, Stack, Text, TextInput } from "components/antd-compat";
import { IconPencil } from "components/antd-icons";
import { useAppSelector } from "../../app/hooks";
import { useAddHrManagerMutation, useLazyGetHrManagersQuery, useLazyGetTeamInterviewDetailsQuery, useRemoveHrManagerMutation, useUpdateTeamInterviewDetailsMutation } from "../../services/api";
import type { HrManager, TeamInterviewDetails, TeamInterviewListItem } from "../../types";
import { HiringManagerPicker } from "../hr/HiringManagerPicker";
import { instantToMoscowInput, moscowInputToInstant } from "../hr/hrDate";

type Props = { accountId: string; teamId: string; interview: TeamInterviewListItem };
type Abortable = { abort: () => void };

export function TeamInterviewEditAction(props: Props) {
  const token = useAppSelector(state => state.auth.token);
  return <TeamInterviewEditSession key={`${props.accountId}:${token}:${props.teamId}:${props.interview.id}`} {...props} token={token} />;
}

function TeamInterviewEditSession({ accountId, teamId, interview, token }: Props & { token: string | null }) {
  const { notification } = App.useApp();
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<TeamInterviewDetails | null>(null);
  const [title, setTitle] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [managers, setManagers] = useState<HrManager[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [hrError, setHrError] = useState("");
  const [pickerPending, setPickerPending] = useState(false);
  const [getDetails] = useLazyGetTeamInterviewDetailsQuery();
  const [getManagers] = useLazyGetHrManagersQuery();
  const [updateDetails, saveState] = useUpdateTeamInterviewDetailsMutation();
  const [addManager, addState] = useAddHrManagerMutation();
  const [removeManager, removeState] = useRemoveHrManagerMutation();
  const generation = useRef(0);
  const active = useRef(true);
  const requests = useRef(new Set<Abortable>());
  const pending = saveState.isLoading || addState.isLoading || removeState.isLoading || pickerPending;
  const scope = { accountId, kind: "TEAM" as const, teamId, query: "interview-details", interviewId: interview.id };
  const invalidate = () => { generation.current += 1; requests.current.forEach(request => request.abort()); requests.current.clear(); };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; invalidate(); };
  }, []);
  const current = (captured: number) => active.current && generation.current === captured && localStorage.getItem("auth_token") === token;
  const track = <T extends Abortable>(request: T): T => { requests.current.add(request); return request; };
  const apply = (details: TeamInterviewDetails) => {
    setSnapshot(details); setTitle(details.title); setCandidateName(details.candidateName ?? "");
    setPosition(details.position ?? ""); setScheduledAt(instantToMoscowInput(details.scheduledAt)); setConflict(false);
  };
  const clear = () => { setSnapshot(null); setTitle(""); setCandidateName(""); setPosition(""); setScheduledAt(""); setManagers([]); setError(""); setHrError(""); setConflict(false); setUnavailable(false); };
  const handleError = (caught: unknown, fallback: string) => {
    const status = caught && typeof caught === "object" && "status" in caught ? caught.status : null;
    if (status === 401 || status === 403 || status === 404) {
      clear(); setUnavailable(true); setError("Доступ к интервью изменился. Закройте окно и обновите список.");
    } else if (status === 410) {
      setUnavailable(true); setError("Интервью в архиве. Изменения недоступны.");
    } else {
      setError(status === 409 ? "Интервью изменил другой участник. Ваш черновик сохранён в форме." : fallback);
      if (status === 409) setConflict(true);
    }
  };
  const load = async () => {
    invalidate(); const captured = generation.current;
    setLoading(true); setError("");
    try {
      const [details, nextManagers] = await Promise.all([
        track(getDetails({ ...scope, requestGeneration: captured }, false)).unwrap(),
        track(getManagers({ inviteCode: interview.inviteCode, requestGeneration: captured }, false)).unwrap(),
      ]);
      if (!current(captured)) return;
      apply(details); setManagers(nextManagers); setUnavailable(false);
    } catch (caught) {
      if (current(captured)) handleError(caught, "Не удалось загрузить интервью. Повторите попытку.");
    } finally { if (current(captured)) setLoading(false); }
  };
  const close = () => {
    if (pending) return;
    invalidate(); setOpened(false); setLoading(false); clear();
  };
  const instant = scheduledAt ? moscowInputToInstant(scheduledAt) : null;
  const changed = snapshot && (title.trim() !== snapshot.title || (candidateName.trim() || null) !== snapshot.candidateName || (position.trim() || null) !== snapshot.position || (scheduledAt && !instant) || (instant ? Date.parse(instant) : null) !== (snapshot.scheduledAt ? Date.parse(snapshot.scheduledAt) : null));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!snapshot || pending || unavailable) return;
    if (!title.trim()) { setError("Введите название интервью"); return; }
    if (scheduledAt && !instant) { setError("Проверьте дату и время интервью"); return; }
    invalidate(); const captured = generation.current; setError(""); setConflict(false);
    try {
      const details = await track(updateDetails({ ...scope, details: {
        title: title.trim(), candidateName: candidateName.trim() || null, position: position.trim() || null,
        scheduledAt: instant, revision: snapshot.revision,
      } })).unwrap();
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
      const next = await track(addManager({ inviteCode: interview.inviteCode, userId })).unwrap();
      if (!current(captured)) return false;
      setManagers(next); notification.success({ title: "Нанимающий добавлен", placement: "top", role: "status" }); return true;
    } catch (caught) {
      if (current(captured)) { setHrError("Не удалось добавить нанимающего. Проверьте ID и повторите попытку."); handleAccessError(caught); }
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
      await track(removeManager({ inviteCode: interview.inviteCode, userId: manager.userId })).unwrap();
      if (!current(captured)) return;
      setManagers(previous => previous.filter(item => item.userId !== manager.userId));
      notification.success({ title: "Роль нанимающего снята", placement: "top", role: "status" });
    } catch (caught) {
      if (current(captured)) { setHrError("Не удалось снять роль нанимающего. Повторите попытку."); handleAccessError(caught); }
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
              <TextInput autoFocus label="Название интервью" placeholder="Введите название интервью" value={title} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.currentTarget.value)} disabled={pending || unavailable} />
              <TextInput label="Имя кандидата" placeholder="Введите имя кандидата" value={candidateName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCandidateName(event.currentTarget.value)} maxLength={200} disabled={pending || unavailable} />
              <TextInput label="Позиция" placeholder="Введите название должности" value={position} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPosition(event.currentTarget.value)} maxLength={200} disabled={pending || unavailable} />
              <TextInput type="datetime-local" label="Дата и время интервью (МСК)" value={scheduledAt} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setScheduledAt(event.currentTarget.value)} disabled={pending || unavailable} />
            </section>
            <section className="app-authoring-section" aria-label="Внешние нанимающие">
              <h4>Внешние нанимающие</h4>
              <Text size="sm" c="gray.5">Добавление и снятие роли применяются сразу.</Text>
              {hrError ? <Alert color="red" role="alert">{hrError}</Alert> : null}
              {managers.length === 0 ? <Text size="sm" c="gray.5">Внешние нанимающие пока не добавлены</Text> : null}
              {managers.map(manager => <Group key={manager.userId} justify="space-between" wrap="wrap"><Text>{manager.displayName}</Text>{!manager.isOwner ? <Button type="button" size="sm" variant="light" color="red" aria-label={`Снять роль нанимающего у ${manager.displayName}`} disabled={pending || unavailable} onClick={() => void remove(manager)}>Снять роль нанимающего</Button> : null}</Group>)}
              <HiringManagerPicker label="Внешний нанимающий (необязательно)" teamId={teamId} selectedIds={managers.map(manager => manager.userId)} disabled={saveState.isLoading || addState.isLoading || removeState.isLoading || unavailable} onPendingChange={setPickerPending} showSuccess={false} onSelect={person => add(person.normalizedId)} />
            </section>
          </> : null}
        </div>
        <div className="app-form-actions">
          <Button type="button" variant="subtle" disabled={pending} onClick={close}>Отмена</Button>
          <Button type="submit" loading={saveState.isLoading} disabled={pending || loading || unavailable || !snapshot || !title.trim() || !changed}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  </>;
}
