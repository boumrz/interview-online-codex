import React, { useEffect, useState } from "react";
import { Button, Checkbox, Divider, Stack, Text, Title } from "@mantine/core";
import type { User } from "../../types";
import { CopyHrId } from "../../features/hr/CopyHrId";

type HrProfileSectionProps = {
  user: User;
  isLoading: boolean;
  onSave: (isHr: boolean) => Promise<boolean>;
};

export function HrProfileSection({ user, isLoading, onSave }: HrProfileSectionProps) {
  const [checked, setChecked] = useState(user.isHr);
  const [error, setError] = useState("");
  const [retryValue, setRetryValue] = useState<boolean | null>(null);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setChecked(user.isHr);
  }, [user.isHr]);

  const save = async (nextIsHr: boolean = checked) => {
    setError("");
    setSuccess("");
    try {
      const applied = await onSave(nextIsHr);
      if (!applied) {
        setChecked(user.isHr);
        return;
      }
      setRetryValue(null);
      setSuccess(nextIsHr
        ? "Функции нанимающего включены"
        : "Функции нанимающего отключены");
    } catch {
      setRetryValue(nextIsHr);
      setChecked(user.isHr);
      setError("Не удалось сохранить профиль. Повторите попытку.");
    }
  };

  return (
    <Stack gap="sm" mt="lg">
      <Divider color="#272b34" />
      <div>
        <Title order={4}>Нанимающий</Title>
        <Text size="sm" c="gray.5" mt={4}>
          Личный список закреплённых интервью. Права в комнатах выдаются отдельно и не меняются при отключении.
        </Text>
      </div>
      <Checkbox
        label="Я нанимающий"
        checked={checked}
        onChange={(event) => setChecked(event.currentTarget.checked)}
        disabled={isLoading}
      />
      {user.isHr ? (
        <CopyHrId id={user.id} />
      ) : null}
      <Button
        type="button"
        onClick={() => void save()}
        disabled={isLoading || checked === user.isHr}
        loading={isLoading}
      >
        {isLoading ? "Сохраняем…" : "Сохранить профиль"}
      </Button>
      {error ? (
        <div role="alert">
          <Text size="sm" c="red.4">{error}</Text>
          {retryValue !== null ? (
            <Button type="button" size="compact-xs" variant="subtle" onClick={() => void save(retryValue)}>
              Повторить
            </Button>
          ) : null}
        </div>
      ) : null}
      <Text size="xs" c="gray.5" aria-live="polite">
        {isLoading ? "Сохраняем настройки…" : success}
      </Text>
    </Stack>
  );
}
