import React, { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Select, Stack, Text } from "components/antd-compat";
import { useAppSelector } from "../../app/hooks";
import { usePreviewHiringManagerMutation } from "../../services/api";
import { getApiErrorMessage } from "../../services/apiErrors";
import type { HiringManagerPreviewResponse } from "../../types";
import styles from "./HiringManagerPicker.module.css";

type Props = {
  label?: string;
  teamId?: string;
  room?: { inviteCode: string; ownerToken?: string; interviewerToken?: string; eventToken?: string };
  selectedIds: readonly string[];
  disabled?: boolean;
  showSuccess?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSelect: (person: HiringManagerPreviewResponse) => Promise<boolean | void> | boolean | void;
};

const validNickname = (nickname: string) => nickname.length >= 3 && nickname.length <= 32 && !/\s/.test(nickname);

export function HiringManagerPicker({ label = "Нанимающий", teamId, room, selectedIds, disabled = false, showSuccess = true, onSelect, onPendingChange }: Props) {
  const { notification } = App.useApp();
  const accountId = useAppSelector(state => state.auth.user?.id ?? "");
  const token = useAppSelector(state => state.auth.token);
  const [preview] = usePreviewHiringManagerMutation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [candidate, setCandidate] = useState<HiringManagerPreviewResponse | null>(null);
  const requestGeneration = useRef(0);
  const requestRef = useRef<ReturnType<typeof preview> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const cancelSearch = () => {
    requestGeneration.current += 1;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    requestRef.current?.abort();
    requestRef.current = null;
  };
  useEffect(() => {
    cancelSearch(); inFlight.current = false;
    setDraft(""); setError(""); setPending(false); setChoosing(false); setCandidate(null);
    onPendingChange?.(false);
    return () => { cancelSearch(); onPendingChange?.(false); };
  }, [accountId, token, teamId, room?.inviteCode, room?.ownerToken, room?.interviewerToken, room?.eventToken]);
  const search = (value: string, immediate = false) => {
    if (disabled || inFlight.current) return;
    cancelSearch();
    const generation = requestGeneration.current;
    const nickname = value.trim();
    setDraft(value); setCandidate(null); setError("");
    setPending(false); onPendingChange?.(false);
    if (!validNickname(nickname)) {
      if (immediate && nickname) setError("Введите ник от 3 до 32 символов без пробелов");
      return;
    }
    setPending(true); onPendingChange?.(true);
    const resolve = async () => {
      debounceRef.current = null;
      const request = preview({ nickname, ...(room ? { room } : teamId ? { teamId } : {}) });
      requestRef.current = request;
      try {
        const person = await request.unwrap();
        if (requestGeneration.current !== generation) return;
        if (selectedIds.includes(person.normalizedId)) setError("Нанимающий уже добавлен");
        else setCandidate(person);
      } catch (caught) {
        if (requestGeneration.current === generation) setError(getApiErrorMessage(caught, "Не удалось найти нанимающего. Повторите попытку."));
      } finally {
        if (requestGeneration.current === generation) {
          requestRef.current = null;
          setPending(false); onPendingChange?.(false);
        }
      }
    };
    if (immediate) void resolve();
    else debounceRef.current = setTimeout(() => void resolve(), 300);
  };
  const choose = async (id: string | null) => {
    if (disabled || inFlight.current || !candidate || id !== candidate.normalizedId) return;
    if (selectedIds.includes(id)) { setError("Нанимающий уже добавлен"); return; }
    const generation = requestGeneration.current;
    inFlight.current = true; setChoosing(true); setPending(true); onPendingChange?.(true); setError("");
    try {
      if (await onSelect(candidate) !== false && requestGeneration.current === generation) {
        setDraft(""); setCandidate(null);
        if (showSuccess) notification.success({
          title: `Нанимающий добавлен: ${candidate.displayName || "Нанимающий"}`,
          placement: "top",
          role: "status",
        });
      }
    } catch (caught) {
      if (requestGeneration.current === generation) setError(getApiErrorMessage(caught, "Не удалось добавить нанимающего. Повторите попытку."));
    } finally {
      if (requestGeneration.current === generation) { setPending(false); setChoosing(false); inFlight.current = false; onPendingChange?.(false); }
    }
  };
  return <Stack gap="xs" className={styles.picker}>
    <Select
      label={label}
      aria-label={label}
      placeholder="Введите ник нанимающего"
      value={null}
      searchValue={draft}
      searchable
      filterOption={false}
      loading={pending}
      disabled={disabled || choosing}
      // Closing the popup emits an empty search; only a native input edit clears the draft.
      onSearch={(value: string) => { if (value !== "") search(value); }}
      onInputCapture={(event: React.FormEvent<HTMLElement>) => {
        if (event.target instanceof HTMLInputElement && event.target.value === "") search("");
      }}
      onChange={(value: string | null) => void choose(value)}
      data={candidate ? [{ value: candidate.normalizedId, label: candidate.displayName || "Нанимающий" }] : []}
      optionRender={() => candidate ? <span className={styles.option}>{candidate.displayName || "Нанимающий"}</span> : null}
      notFoundContent={pending ? "Проверяем нанимающего…" : error || null}
      onInputKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && !candidate) {
          event.preventDefault(); event.stopPropagation(); search(draft, true);
        }
      }}
    />
    {error ? <Text role="alert" c="red.4" size="sm">{error}</Text> : null}
  </Stack>;
}
