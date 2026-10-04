import React, { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { Select, Stack, Text } from "components/antd-compat";
import { useAppSelector } from "../../app/hooks";
import { usePreviewHiringManagerMutation } from "../../services/api";
import type { HiringManagerPreviewResponse } from "../../types";
import styles from "./HiringManagerPicker.module.css";

type Props = {
  label?: string;
  teamId?: string;
  selectedIds: readonly string[];
  disabled?: boolean;
  showSuccess?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSelect: (person: HiringManagerPreviewResponse) => Promise<boolean | void> | boolean | void;
};

export function HiringManagerPicker({ label = "Нанимающий", teamId, selectedIds, disabled = false, showSuccess = true, onSelect, onPendingChange }: Props) {
  const { notification } = App.useApp();
  const accountId = useAppSelector(state => state.auth.user?.id ?? "");
  const [preview] = usePreviewHiringManagerMutation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [candidate, setCandidate] = useState<HiringManagerPreviewResponse | null>(null);
  const requestGeneration = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    requestGeneration.current += 1; inFlight.current = false;
    setDraft(""); setError(""); setPending(false); setChoosing(false); setCandidate(null);
    return () => { requestGeneration.current += 1; onPendingChange?.(false); };
  }, [accountId, teamId]);
  const fullId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const errorMessage = (caught: unknown) => {
    const data = caught && typeof caught === "object" && "data" in caught ? caught.data : null;
    return data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "Не удалось добавить нанимающего. Проверьте ID и повторите попытку.";
  };
  const search = async (value: string) => {
    if (disabled || inFlight.current) return;
    const generation = ++requestGeneration.current;
    const normalizedId = value.trim().toLowerCase();
    setDraft(value); setCandidate(null); setError("");
    setPending(false); onPendingChange?.(false);
    if (!fullId(normalizedId)) return;
    if (selectedIds.includes(normalizedId)) { setError("Нанимающий уже добавлен"); return; }
    setPending(true); onPendingChange?.(true);
    try {
      const person = accountId
        ? await preview({ invitationId: normalizedId, ...(teamId ? { teamId } : {}) }).unwrap()
        : { normalizedId, displayName: "" };
      if (requestGeneration.current !== generation) return;
      setCandidate(person);
    } catch (caught) {
      if (requestGeneration.current === generation) setError(errorMessage(caught));
    } finally {
      if (requestGeneration.current === generation) { setPending(false); onPendingChange?.(false); }
    }
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
          title: `Нанимающий добавлен: ${candidate.displayName || candidate.normalizedId}`,
          placement: "top",
          role: "status",
        });
      }
    } catch (caught) {
      if (requestGeneration.current === generation) setError(errorMessage(caught));
    } finally {
      if (requestGeneration.current === generation) { setPending(false); setChoosing(false); inFlight.current = false; onPendingChange?.(false); }
    }
  };
  return <Stack gap="xs" className={styles.picker}>
    <Select
      label={label}
      aria-label={label}
      placeholder="Вставьте ID нанимающего"
      value={null}
      searchValue={draft}
      searchable
      filterOption={false}
      loading={pending}
      disabled={disabled || choosing}
      // Closing a single-select popup emits an empty search without a user edit.
      // Accept deletion through the native input event so blur retains the draft.
      onSearch={(value: string) => { if (value !== "") void search(value); }}
      onInputCapture={(event: React.FormEvent<HTMLElement>) => {
        if (event.target instanceof HTMLInputElement && event.target.value === "") void search("");
      }}
      onChange={(value: string | null) => void choose(value)}
      data={candidate ? [{ value: candidate.normalizedId, label: candidate.displayName || candidate.normalizedId }] : []}
      optionRender={() => candidate ? <span className={styles.option}><span>{candidate.displayName || candidate.normalizedId}</span><span className={styles.optionId}>{candidate.normalizedId}</span></span> : null}
      notFoundContent={pending ? "Проверяем нанимающего…" : error || "Вставьте полный ID нанимающего"}
      onInputKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && !candidate) {
          event.preventDefault();
          event.stopPropagation();
          if (draft.trim() && !fullId(draft.trim())) setError("Введите полный UUID нанимающего");
        }
      }}
    />
    {pending ? <Text role="status" size="sm" c="var(--app-muted)">Проверяем нанимающего…</Text> : null}
    {error ? <Text role="alert" c="red.4" size="sm">{error}</Text> : null}
  </Stack>;
}
