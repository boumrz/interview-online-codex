import React, { useEffect, useRef, useState } from "react";
import { Switch } from "antd";
import { Button, Divider, Stack, Text } from "components/antd-compat";
import type { User } from "../../types";
import { CopyHrId } from "../../features/hr/CopyHrId";
import styles from "./HrProfileSection.module.css";

type HrProfileSectionProps = { user: User; isLoading: boolean; onSave: (isHr: boolean) => Promise<boolean>; showIdentity?: boolean };
export function HrProfileSection({ user, isLoading, onSave, showIdentity = true }: HrProfileSectionProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; inFlight.current = false;
    setPending(false); setError(""); setRetryValue(null);
    return () => { generation.current += 1; };
  }, [user.id]);
  const save = async (desired: boolean) => {
    if (isLoading || inFlight.current) return;
    const current = generation.current;
    inFlight.current = true; setPending(true); setError("");
    try {
      const applied = await onSave(desired);
      if (generation.current !== current || !applied) return;
      setRetryValue(null);
    } catch {
      if (generation.current !== current) return;
      setRetryValue(desired); setError("Не удалось сохранить. Повторите попытку.");
    } finally {
      if (generation.current === current) { inFlight.current = false; setPending(false); }
    }
  };
  return <Stack gap="sm" className={styles.section}>
    <Divider color="var(--app-border)" />
    <div className={styles.toggleRow}>
      <Text fw={600}>Я участвую в найме</Text>
      <Switch aria-label="Я участвую в найме" checked={user.isHr} loading={pending || isLoading}
        disabled={pending || isLoading} onChange={(value) => void save(value)} />
    </div>
    {user.isHr && showIdentity ? <CopyHrId nickname={user.nickname} /> : null}
    {error ? <div role="alert" className={styles.error}>
      <Text size="sm" c="red.4">{error}</Text>
      {retryValue !== null ? <Button type="button" variant="subtle" size="compact-xs" disabled={pending || isLoading} onClick={() => void save(retryValue)}>Повторить</Button> : null}
    </div> : null}
    {pending ? <Text size="sm" role="status" aria-live="polite" c="var(--app-muted)">Сохраняем…</Text> : null}
  </Stack>;
}
